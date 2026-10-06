import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import helmet from "helmet";
import multer from "multer";
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  rm,
  readdir,
  rename,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { configSchema, defaultConfig, type JobView } from "@folio/shared";
import { appendPdf, inspectPdf, renderPdf } from "./pdf.js";
import { convertWord } from "./convert.js";
import type { Store, Job } from "./store.js";
import { installAuth, type AuthSettings } from "./auth.js";

export type Settings = {
  dataDir: string;
  /** 0 = sin límite de tamaño. */
  maxBytes: number;
  maxPages: number;
  ttlMs: number;
  conversionTimeout: number;
  soffice?: string;
  auth?: AuthSettings;
  /** Orígenes del frontend autorizados a llamar a la API con credenciales (CORS). */
  corsOrigins?: string[];
  /** Proxies inversos delante del backend; 0 = conexión directa. */
  trustProxy?: number;
};
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const view = ({ tokenHash: _, ...job }: Job): JobView => job;

export function createApp(
  store: Store,
  settings: Settings,
  converter = convertWord,
) {
  const app = express();
  if (settings.trustProxy) app.set("trust proxy", settings.trustProxy);
  const origins = new Set(settings.corsOrigins);
  app.use(helmet({ crossOriginResourcePolicy: { policy: "same-site" } }));
  // Va antes del login: las solicitudes preliminares (OPTIONS) no llevan cookie.
  app.use((req, res, next) => {
    res.vary("Origin");
    const origin = req.get("origin");
    if (!origin || !origins.has(origin)) return next();
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    if (req.method !== "OPTIONS") return next();
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Max-Age", "600");
    res.status(204).end();
  });
  app.use(express.json({ limit: "1mb" }));
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  installAuth(app, settings.auth, origins);
  const root = path.resolve(settings.dataDir);
  const dir = (id: string) => {
    if (!z.string().uuid().safeParse(id).success)
      throw new HttpError(404, "Trabajo no encontrado.");
    return path.join(root, id);
  };
  const locks = new Set<string>();
  let conversionQueue: Promise<unknown> = Promise.resolve();
  const pending = new Set<Promise<unknown>>();
  const track = (task: Promise<unknown>) => {
    pending.add(task);
    task.finally(() => pending.delete(task)).catch(console.error);
  };
  async function exclusive<T>(id: string, task: () => Promise<T>): Promise<T> {
    if (locks.has(id))
      throw new HttpError(
        409,
        "El documento está procesándose. Intenta nuevamente en unos segundos.",
      );
    locks.add(id);
    try {
      return await task();
    } finally {
      locks.delete(id);
    }
  }
  async function authorized(req: Request): Promise<Job> {
    const id = String(req.params.id);
    dir(id);
    const job = await store.get(id);
    const token = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
    if (
      !job ||
      !timingSafeEqual(Buffer.from(hash(token)), Buffer.from(job.tokenHash))
    )
      throw new HttpError(404, "Trabajo no encontrado o acceso no válido.");
    if (Date.parse(job.expiresAt) <= Date.now())
      throw new HttpError(
        410,
        "El trabajo expiró. Vuelve a cargar el documento.",
      );
    return job;
  }
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      ...(settings.maxBytes > 0 && { fileSize: settings.maxBytes }),
      files: 1,
      fields: 0,
    },
  });
  function fileKind(file: Express.Multer.File | undefined) {
    if (!file) throw new HttpError(400, "Selecciona un archivo.");
    const kind = path.extname(file.originalname).slice(1).toLowerCase();
    if (!["pdf", "doc", "docx"].includes(kind))
      throw new HttpError(400, "Solo se admiten PDF, DOC y DOCX.");
    const validMagic =
      kind === "pdf"
        ? file.buffer.subarray(0, 1024).includes(Buffer.from("%PDF-"))
        : kind === "doc"
          ? file.buffer
              .subarray(0, 8)
              .equals(Buffer.from("d0cf11e0a1b11ae1", "hex"))
          : file.buffer.subarray(0, 4).equals(Buffer.from("504b0304", "hex"));
    if (!validMagic)
      throw new HttpError(
        400,
        "El contenido del archivo no coincide con su extensión.",
      );
    return { file, kind: kind as Job["kind"] };
  }
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.get("/api/limits", (_req, res) =>
    res.json({
      maxBytes: settings.maxBytes,
      maxPages: settings.maxPages,
      ttlHours: settings.ttlMs / 3600000,
    }),
  );
  app.post("/api/jobs", upload.single("file"), async (req, res) => {
    const { file, kind } = fileKind(req.file);
    const id = randomUUID(),
      token = randomBytes(32).toString("hex");
    const job: Job = {
      id,
      tokenHash: hash(token),
      name: Buffer.from(file.originalname, "latin1")
        .toString("utf8")
        .slice(0, 240),
      kind,
      status: "processing",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + settings.ttlMs).toISOString(),
      pages: [],
      config: null,
      revision: 0,
      renderedRevision: null,
      error: null,
    };
    await mkdir(dir(id), { recursive: true });
    const input = path.join(dir(id), `original.${kind}`);
    try {
      await writeFile(input, file.buffer);
      await store.create(job);
    } catch (error) {
      await rm(dir(id), { recursive: true, force: true });
      throw error;
    }
    const process = async () => {
      try {
        await exclusive(id, async () => {
          if (!(await store.get(id))) return;
          const bytes =
            kind === "pdf"
              ? await readFile(input)
              : await converter(
                  input,
                  dir(id),
                  settings.conversionTimeout,
                  settings.soffice,
                );
          const pages = await inspectPdf(bytes, settings.maxPages);
          await writeFile(path.join(dir(id), "source.pdf"), bytes);
          await store.update(id, {
            status: "ready",
            pages,
            config: defaultConfig(pages),
            revision: 1,
            error: null,
          });
        });
      } catch (error) {
        if (await store.get(id))
          await store.update(id, {
            status: "failed",
            error:
              error instanceof Error
                ? error.message
                : "No se pudo procesar el archivo.",
          });
      }
    };
    if (kind === "pdf") track(process());
    else {
      conversionQueue = conversionQueue.then(process, process);
      track(conversionQueue);
    }
    res.status(202).json({ job: view(job), token });
  });
  app.get("/api/jobs/:id", async (req, res) =>
    res.json(view(await authorized(req))),
  );
  app.get("/api/jobs/:id/source", async (req, res) => {
    const job = await authorized(req);
    if (!job.config)
      throw new HttpError(409, "El documento todavía no está disponible.");
    res.type("pdf").send(await readFile(path.join(dir(job.id), "source.pdf")));
  });
  app.post("/api/jobs/:id/files", upload.single("file"), async (req, res) => {
    const auth = await authorized(req);
    const { file, kind } = fileKind(req.file);
    const revision = z.coerce.number().int().parse(req.query.revision);
    const position =
      req.query.position === undefined
        ? undefined
        : z.coerce.number().int().min(0).parse(req.query.position);
    const append = () =>
      exclusive(auth.id, async () => {
        const job = (await store.get(auth.id))!;
        if (!job.config)
          throw new HttpError(409, "Espera a que termine el procesamiento.");
        if (job.revision !== revision)
          throw new HttpError(409, "La edición cambió. Recarga el documento.");
        const input = path.join(dir(job.id), `extra-${randomUUID()}.${kind}`);
        let merged: Awaited<ReturnType<typeof appendPdf>>;
        try {
          await writeFile(input, file.buffer);
          const bytes =
            kind === "pdf"
              ? file.buffer
              : await converter(
                  input,
                  dir(job.id),
                  settings.conversionTimeout,
                  settings.soffice,
                );
          merged = await appendPdf(
            await readFile(path.join(dir(job.id), "source.pdf")),
            bytes,
            settings.maxPages,
          );
        } catch (error) {
          throw new HttpError(
            422,
            error instanceof Error
              ? error.message
              : "No se pudo añadir el archivo.",
          );
        } finally {
          await rm(input, { force: true });
        }
        const staged = path.join(dir(job.id), "source.next.pdf");
        await writeFile(staged, merged.bytes);
        await rename(staged, path.join(dir(job.id), "source.pdf"));
        const current = job.config.pages,
          at = Math.min(position ?? current.length, current.length);
        const patch = {
          pages: [...job.pages, ...merged.pages],
          config: {
            ...job.config,
            pages: [
              ...current.slice(0, at),
              ...defaultConfig(merged.pages).pages,
              ...current.slice(at),
            ],
          },
          revision: job.revision + 1,
          renderedRevision: null,
          status: "ready" as const,
          error: null,
        };
        await store.update(job.id, patch);
        return view({ ...job, ...patch });
      });
    if (kind === "pdf") res.json(await append());
    else {
      const task = conversionQueue.then(append, append);
      conversionQueue = task.catch(() => {});
      res.json(await task);
    }
  });
  app.put("/api/jobs/:id/config", async (req, res) => {
    const auth = await authorized(req);
    await exclusive(auth.id, async () => {
      const job = (await store.get(auth.id))!;
      const body = z
        .object({ revision: z.number().int(), config: configSchema })
        .strict()
        .parse(req.body);
      if (job.revision !== body.revision)
        throw new HttpError(409, "La edición cambió. Recarga el documento.");
      if (!job.config)
        throw new HttpError(409, "Espera a que termine el procesamiento.");
      // Se admite un subconjunto: las páginas eliminadas no aparecen en la configuración.
      if (body.config.pages.some((p) => job.pages[p.sourceIndex]?.id !== p.id))
        throw new HttpError(
          400,
          "La configuración no corresponde a las páginas originales.",
        );
      const patch = {
        config: body.config,
        revision: job.revision + 1,
        renderedRevision: null,
        status: "ready" as const,
        error: null,
      };
      await store.update(job.id, patch);
      res.json(view({ ...job, ...patch }));
    });
  });
  app.post("/api/jobs/:id/render", async (req, res) => {
    const auth = await authorized(req);
    await exclusive(auth.id, async () => {
      const job = (await store.get(auth.id))!;
      const { revision } = z
        .object({ revision: z.number().int() })
        .strict()
        .parse(req.body);
      if (!job.config || revision !== job.revision)
        throw new HttpError(
          409,
          "Guarda la configuración vigente antes de generar la revisión.",
        );
      await store.update(job.id, { status: "rendering", error: null });
      try {
        const bytes = await renderPdf(
          await readFile(path.join(dir(job.id), "source.pdf")),
          job.config,
        );
        await writeFile(path.join(dir(job.id), "review.pdf"), bytes);
        const patch = {
          status: "review" as const,
          renderedRevision: revision,
          error: null,
        };
        await store.update(job.id, patch);
        res.json(view({ ...job, ...patch }));
      } catch (error) {
        await store.update(job.id, {
          status: "ready",
          renderedRevision: null,
          error:
            error instanceof Error
              ? error.message
              : "No se pudo generar el PDF.",
        });
        throw new HttpError(
          422,
          error instanceof Error ? error.message : "No se pudo generar el PDF.",
        );
      }
    });
  });
  for (const route of ["preview", "download"])
    app.get(`/api/jobs/:id/${route}`, async (req, res) => {
      const job = await authorized(req);
      await exclusive(job.id, async () => {
        const current = (await store.get(job.id))!;
        if (
          current.status !== "review" ||
          current.renderedRevision !== current.revision
        )
          throw new HttpError(
            409,
            "Genera una revisión de la edición actual antes de descargar.",
          );
        const revision = Number(req.query.revision);
        if (revision !== current.renderedRevision)
          throw new HttpError(409, "Esta revisión ya no está vigente.");
        const bytes = await readFile(path.join(dir(job.id), "review.pdf"));
        if (route === "download")
          res.attachment(`${path.parse(job.name).name}-foliado.pdf`);
        res.type("pdf").send(bytes);
      });
    });
  app.delete("/api/jobs/:id", async (req, res) => {
    const job = await authorized(req);
    await exclusive(job.id, async () => {
      await rm(dir(job.id), { recursive: true, force: true });
      await store.delete(job.id);
    });
    res.status(204).end();
  });
  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({ error: error.issues.map((i) => i.message).join(" ") });
        return;
      }
      if (error instanceof multer.MulterError) {
        res
          .status(400)
          .json({
            error:
              error.code === "LIMIT_FILE_SIZE"
                ? `El archivo supera ${Math.round(settings.maxBytes / 1024 / 1024)} MB.`
                : "La carga no es válida. Usa un solo archivo.",
          });
        return;
      }
      if (error instanceof HttpError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      if (error instanceof SyntaxError) {
        res.status(400).json({ error: "La solicitud no es válida." });
        return;
      }
      console.error(error);
      res
        .status(500)
        .json({
          error: "No se pudo completar la operación. Intenta nuevamente.",
        });
    },
  );
  async function cleanup() {
    await mkdir(root, { recursive: true });
    const jobs = await store.all();
    for (const job of jobs)
      if (Date.parse(job.expiresAt) <= Date.now() && !locks.has(job.id)) {
        await exclusive(job.id, async () => {
          await rm(dir(job.id), { recursive: true, force: true });
          await store.delete(job.id);
        });
      }
    const known = new Set(jobs.map((j) => j.id));
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (
        entry.isDirectory() &&
        z.string().uuid().safeParse(entry.name).success &&
        !known.has(entry.name)
      ) {
        const info = await stat(dir(entry.name));
        if (Date.now() - info.mtimeMs > settings.ttlMs)
          await rm(dir(entry.name), { recursive: true, force: true });
      }
    }
  }
  async function recover() {
    await cleanup();
    for (const job of await store.all()) {
      if (job.status === "processing")
        await store.update(job.id, {
          status: "failed",
          error: "El procesamiento se interrumpió. Vuelve a cargar el archivo.",
        });
      if (job.status === "rendering")
        await store.update(job.id, {
          status: "ready",
          renderedRevision: null,
          error: "La generación se interrumpió. Genera una nueva revisión.",
        });
    }
  }
  return { app, cleanup, recover, idle: () => Promise.all([...pending]) };
}
