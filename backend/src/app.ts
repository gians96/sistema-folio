import express, {
  type Request,
  type RequestHandler,
  type Response,
  type NextFunction,
} from "express";
import helmet from "helmet";
import multer from "multer";
import { randomUUID } from "node:crypto";
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
import {
  adminSettingsSchema,
  configSchema,
  defaultConfig,
  titleSchema,
  userPatchSchema,
  type AdminSettings,
  type JobSummary,
  type Limits,
  type UserView,
} from "@folio/shared";
import { appendPdf, inspectPdf, renderPdf } from "./pdf.js";
import { convertWord } from "./convert.js";
import type { Store, Job, Owner } from "./store.js";
import { installAuth, publicUser, type AuthSettings } from "./auth.js";

export type Settings = {
  dataDir: string;
  maxPages: number;
  conversionTimeout: number;
  soffice?: string;
  auth: AuthSettings;
  /** Orígenes del frontend autorizados a llamar a la API con credenciales (CORS). */
  corsOrigins?: string[];
};
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
/** Valores iniciales de la configuración que edita el owner. */
const defaults: AdminSettings = { maxFileMb: 95, registration: "open" };
/** Carpetas sin trabajo en la base (cargas interrumpidas, usuarios borrados). */
const orphanMs = 60 * 60 * 1000;
const current = (res: Response) => res.locals.user as UserView;
const summary = ({
  pages,
  config,
  revision: _,
  renderedRevision: __,
  ...job
}: Job & { owner: Owner }): JobSummary => ({
  ...job,
  pages: config?.pages.length ?? pages.length,
  included: config?.pages.filter((p) => p.included).length ?? 0,
});
const fileName = (title: string) =>
  title.replace(/[\\/:*?"<>|\x00-\x1f]+/g, "-").trim() || "documento";

export function createApp(
  store: Store,
  settings: Settings,
  converter = convertWord,
) {
  const app = express();
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
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Max-Age", "600");
    res.status(204).end();
  });
  app.use(express.json({ limit: "1mb" }));
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  installAuth(app, store, settings.auth, origins);
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
  /** El trabajo debe ser del usuario; el owner puede abrir cualquiera. */
  async function authorized(req: Request, res: Response): Promise<Job> {
    const id = String(req.params.id);
    dir(id);
    const job = await store.get(id);
    const user = current(res);
    if (!job || (job.userId !== user.id && user.role !== "owner"))
      throw new HttpError(404, "Trabajo no encontrado.");
    return job;
  }
  async function adminSettings(): Promise<AdminSettings> {
    const [maxFileMb, registration] = await Promise.all([
      store.getSetting("maxFileMb"),
      store.getSetting("registration"),
    ]);
    const mb = Number(maxFileMb);
    return {
      maxFileMb:
        maxFileMb !== null && Number.isInteger(mb) && mb >= 0
          ? mb
          : defaults.maxFileMb,
      registration: registration === "approval" ? "approval" : "open",
    };
  }
  async function limitsFor(user: UserView): Promise<Limits> {
    const mb = user.maxFileMb ?? (await adminSettings()).maxFileMb;
    return { maxBytes: mb * 1024 * 1024, maxPages: settings.maxPages };
  }
  // El límite depende del usuario y de la configuración vigente: se crea por petición.
  const upload: RequestHandler = async (req, res, next) => {
    const { maxBytes } = await limitsFor(current(res));
    multer({
      storage: multer.memoryStorage(),
      limits: {
        ...(maxBytes > 0 && { fileSize: maxBytes }),
        files: 1,
        fields: 0,
      },
    }).single("file")(req, res, (error?: unknown) =>
      next(
        error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE"
          ? new HttpError(
              413,
              `El archivo supera ${Math.round(maxBytes / 1024 / 1024)} MB.`,
            )
          : error,
      ),
    );
  };
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
  app.get("/api/limits", async (_req, res) =>
    res.json(await limitsFor(current(res))),
  );
  app.get("/api/jobs", async (_req, res) =>
    res.json((await store.list(current(res).id)).map(summary)),
  );
  app.post("/api/jobs", upload, async (req, res) => {
    const { file, kind } = fileKind(req.file);
    const id = randomUUID(),
      now = new Date().toISOString();
    const name = Buffer.from(file.originalname, "latin1")
      .toString("utf8")
      .slice(0, 240);
    const job: Job = {
      id,
      userId: current(res).id,
      title: path.parse(name).name.trim().slice(0, 120) || "Trabajo sin nombre",
      name,
      kind,
      status: "processing",
      createdAt: now,
      updatedAt: now,
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
    res.status(202).json({ job });
  });
  app.get("/api/jobs/:id", async (req, res) =>
    res.json(await authorized(req, res)),
  );
  app.patch("/api/jobs/:id", async (req, res) => {
    const job = await authorized(req, res);
    const { title } = z.object({ title: titleSchema }).strict().parse(req.body);
    // Renombrar no cambia la edición: no se toca la revisión.
    await store.update(job.id, { title });
    res.json(await store.get(job.id));
  });
  app.get("/api/jobs/:id/source", async (req, res) => {
    const job = await authorized(req, res);
    if (!job.config)
      throw new HttpError(409, "El documento todavía no está disponible.");
    res.type("pdf").send(await readFile(path.join(dir(job.id), "source.pdf")));
  });
  app.post("/api/jobs/:id/files", upload, async (req, res) => {
    const auth = await authorized(req, res);
    const { file, kind } = fileKind(req.file);
    const revision = z.coerce.number().int().parse(req.query.revision);
    const position =
      req.query.position === undefined
        ? undefined
        : z.coerce.number().int().min(0).parse(req.query.position);
    const append = () =>
      exclusive(auth.id, async () => {
        const job = await store.get(auth.id);
        if (!job) throw new HttpError(404, "Trabajo no encontrado.");
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
        return { ...job, ...patch };
      });
    if (kind === "pdf") res.json(await append());
    else {
      const task = conversionQueue.then(append, append);
      conversionQueue = task.catch(() => {});
      res.json(await task);
    }
  });
  app.put("/api/jobs/:id/config", async (req, res) => {
    const auth = await authorized(req, res);
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
      res.json({ ...job, ...patch });
    });
  });
  app.post("/api/jobs/:id/render", async (req, res) => {
    const auth = await authorized(req, res);
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
        res.json({ ...job, ...patch });
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
      const job = await authorized(req, res);
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
          res.attachment(`${fileName(current.title)}-foliado.pdf`);
        res.type("pdf").send(bytes);
      });
    });
  app.delete("/api/jobs/:id", async (req, res) => {
    const job = await authorized(req, res);
    await exclusive(job.id, async () => {
      await rm(dir(job.id), { recursive: true, force: true });
      await store.delete(job.id);
    });
    res.status(204).end();
  });
  // Administración (solo owner; el control de acceso está en installAuth).
  app.get("/api/admin/settings", async (_req, res) =>
    res.json(await adminSettings()),
  );
  app.put("/api/admin/settings", async (req, res) => {
    const body = adminSettingsSchema.parse(req.body);
    await store.setSetting("maxFileMb", String(body.maxFileMb));
    await store.setSetting("registration", body.registration);
    res.json(body);
  });
  app.get("/api/admin/users", async (_req, res) =>
    res.json(
      (await store.users()).map(({ jobs, ...user }) => ({
        ...publicUser(user, settings.auth.ownerEmail),
        jobs,
      })),
    ),
  );
  async function account(req: Request) {
    const user = await store.getUser(String(req.params.id));
    if (!user) throw new HttpError(404, "Usuario no encontrado.");
    return {
      user,
      owner: publicUser(user, settings.auth.ownerEmail).role === "owner",
    };
  }
  app.patch("/api/admin/users/:id", async (req, res) => {
    const patch = userPatchSchema.parse(req.body);
    const { user, owner } = await account(req);
    if (owner && patch.status)
      throw new HttpError(400, "No puedes cambiar el estado del propietario.");
    await store.updateUser(user.id, patch);
    res.json(publicUser({ ...user, ...patch }, settings.auth.ownerEmail));
  });
  app.delete("/api/admin/users/:id", async (req, res) => {
    const { user, owner } = await account(req);
    if (owner) throw new HttpError(400, "No puedes eliminar al propietario.");
    // Bloqueado, ya no puede crear trabajos mientras se borran los suyos.
    await store.updateUser(user.id, { status: "blocked" });
    const jobs = await store.list(user.id);
    await store.deleteUser(user.id);
    for (const job of jobs)
      await rm(dir(job.id), { recursive: true, force: true });
    res.status(204).end();
  });
  app.get("/api/admin/jobs", async (_req, res) =>
    res.json((await store.list()).map(summary)),
  );
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
          .json({ error: "La carga no es válida. Usa un solo archivo." });
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
    const known = new Set(await store.ids());
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (
        entry.isDirectory() &&
        z.string().uuid().safeParse(entry.name).success &&
        !known.has(entry.name) &&
        !locks.has(entry.name)
      ) {
        const info = await stat(dir(entry.name));
        if (Date.now() - info.mtimeMs > orphanMs)
          await rm(dir(entry.name), { recursive: true, force: true });
      }
    }
  }
  async function recover() {
    await cleanup();
    for (const job of await store.unfinished()) {
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
