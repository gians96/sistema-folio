import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { mkdtemp, mkdir, rm, access, readFile, utimes } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { PDFDocument } from "pdf-lib";
import { SignJWT } from "jose";
import { createApp, type Settings } from "../src/app.js";
import { loadJwtSecret, type GoogleVerifier } from "../src/auth.js";
import { MemoryStore } from "./support.js";

const owner = "propietaria@gmail.com";
/** Credencial de prueba "sub|correo"; con "|sin-verificar" Google la rechaza. */
const fakeGoogle: GoogleVerifier = async (credential) => {
  const [sub, email, flag] = credential.split("|");
  if (!sub || !email || flag === "sin-verificar")
    throw new Error("Credencial no válida.");
  return {
    sub,
    email,
    name: email.split("@")[0],
    picture: null,
    authoritative: email.endsWith("@gmail.com"),
  };
};
let directory: string, settings: Settings;
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "folio-test-"));
  settings = {
    dataDir: directory,
    maxPages: 500,
    conversionTimeout: 500,
    auth: {
      googleClientId: "cliente-de-prueba.apps.googleusercontent.com",
      ownerEmail: owner,
      jwtSecret: Buffer.alloc(32, 7),
      secureCookie: true,
      verifyGoogle: fakeGoogle,
    },
  };
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
type App = ReturnType<typeof createApp>["app"];
const google = (app: App, email: string) =>
  request(app)
    .post("/api/auth/google")
    .send({ credential: `sub-${email}|${email}` });
/** Inicia sesión con Google (falso) y devuelve la cookie de sesión. */
async function login(app: App, email: string) {
  const response = await google(app, email).expect(200);
  return response.headers["set-cookie"][0].split(";")[0] as string;
}
async function pdf() {
  const doc = await PDFDocument.create();
  doc.addPage();
  doc.addPage([400, 300]);
  return Buffer.from(await doc.save());
}
async function onePage() {
  const doc = await PDFDocument.create();
  doc.addPage();
  return Buffer.from(await doc.save());
}
/** PDF de 1 MB + 1 byte (válido para la carga; falla al procesarse). */
const overOneMb = () =>
  Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(1024 * 1024 - 8)]);
const parseBinary = (
  res: any,
  callback: (e: Error | null, data?: Buffer) => void,
) => {
  const chunks: Buffer[] = [];
  res.on("data", (data: Buffer) => chunks.push(data));
  res.on("end", () => callback(null, Buffer.concat(chunks)));
};
describe("Acceso con Google", () => {
  it("emite un JWT de 12 horas en cookie, identifica al owner y cierra sesión", async () => {
    const service = createApp(new MemoryStore(), settings);
    await request(service.app).get("/api/auth/session").expect(200, {
      googleClientId: "cliente-de-prueba.apps.googleusercontent.com",
      user: null,
    });
    await request(service.app).get("/api/limits").expect(401);
    await request(service.app).post("/api/jobs").attach("file", await pdf(), "x.pdf").expect(401);
    await request(service.app).post("/api/auth/google").send({}).expect(400);
    await request(service.app).post("/api/auth/google").send({ credential: "basura" }).expect(401);
    await request(service.app).post("/api/auth/google")
      .send({ credential: `s1|${owner}|sin-verificar` }).expect(401);
    const signed = await request(service.app).post("/api/auth/google")
      .send({ credential: `s1|${owner}` }).expect(200);
    expect(signed.body.user).toMatchObject({ email: owner, role: "owner", status: "active" });
    expect(signed.body.user.googleSub).toBeUndefined();
    const header = signed.headers["set-cookie"][0];
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("SameSite=Strict");
    expect(header).toContain("Max-Age=43200");
    const cookie = header.split(";")[0];
    const session = await request(service.app).get("/api/auth/session")
      .set("Cookie", cookie).expect(200);
    expect(session.body.user).toMatchObject({ email: owner, role: "owner" });
    const user = await request(service.app).post("/api/auth/google")
      .send({ credential: "s2|ana@gmail.com" }).expect(200);
    expect(user.body.user.role).toBe("user");
    // JWT alterado o vencido.
    await request(service.app).get("/api/limits")
      .set("Cookie", `${cookie.slice(0, -2)}xx`).expect(401);
    const now = Math.floor(Date.now() / 1000);
    const expired = await new SignJWT()
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(signed.body.user.id)
      .setIssuedAt(now - 50000)
      .setExpirationTime(now - 10)
      .sign(settings.auth.jwtSecret);
    await request(service.app).get("/api/limits")
      .set("Cookie", `folio_session=${expired}`).expect(401);
    const forged = await new SignJWT()
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(signed.body.user.id)
      .setExpirationTime(now + 3600)
      .sign(Buffer.alloc(32, 9));
    await request(service.app).get("/api/limits")
      .set("Cookie", `folio_session=${forged}`).expect(401);
    const logout = await request(service.app).post("/api/auth/logout")
      .set("Cookie", cookie).expect(204);
    expect(logout.headers["set-cookie"][0]).toContain("folio_session=;");
  });
  it("solo es owner el correo configurado si Google lo administra", async () => {
    const service = createApp(new MemoryStore(), {
      ...settings,
      auth: { ...settings.auth, ownerEmail: "jefa@empresa.test" },
    });
    const response = await request(service.app).post("/api/auth/google")
      .send({ credential: "s9|jefa@empresa.test" }).expect(200);
    expect(response.body.user.role).toBe("user");
  });
  it("acepta el frontend de otro subdominio con CORS y rechaza los demás orígenes", async () => {
    const frontend = "https://folio.ejemplo.test";
    const service = createApp(new MemoryStore(), { ...settings, corsOrigins: [frontend] });
    const preflight = await request(service.app).options("/api/jobs/x")
      .set("Origin", frontend)
      .set("Access-Control-Request-Method", "PATCH")
      .expect(204);
    expect(preflight.headers["access-control-allow-origin"]).toBe(frontend);
    expect(preflight.headers["access-control-allow-credentials"]).toBe("true");
    expect(preflight.headers["access-control-allow-methods"]).toContain("PATCH");
    await request(service.app).options("/api/jobs")
      .set("Origin", "https://otro-dominio.test")
      .set("Access-Control-Request-Method", "POST")
      .expect(401);
    await request(service.app).post("/api/auth/google")
      .set("Origin", "https://otro-dominio.test")
      .send({ credential: `s1|${owner}` })
      .expect(403);
    const signed = await request(service.app).post("/api/auth/google")
      .set("Origin", frontend)
      .send({ credential: `s1|${owner}` })
      .expect(200);
    expect(signed.headers["access-control-allow-origin"]).toBe(frontend);
    const cookie = signed.headers["set-cookie"][0].split(";")[0];
    const uploaded = await request(service.app).post("/api/jobs")
      .set("Origin", frontend).set("Cookie", cookie)
      .attach("file", await pdf(), "x.pdf").expect(202);
    expect(uploaded.headers["access-control-allow-origin"]).toBe(frontend);
    const other = await request(service.app).post("/api/jobs")
      .set("Origin", "https://otro-dominio.test").set("Cookie", cookie)
      .attach("file", await pdf(), "x.pdf").expect(403);
    expect(other.headers["access-control-allow-origin"]).toBeUndefined();
    await service.idle();
  });
  it("guarda la clave de los JWT en DATA_DIR y la reutiliza", async () => {
    const first = await loadJwtSecret(directory);
    expect(first).toHaveLength(32);
    expect((await readFile(path.join(directory, ".jwt-secret"), "utf8")).trim())
      .toBe(first.toString("hex"));
    expect((await loadJwtSecret(directory)).equals(first)).toBe(true);
  });
});
describe("Administración", () => {
  it("registra con acceso inmediato o con aprobación y bloquea al instante", async () => {
    const store = new MemoryStore(),
      service = createApp(store, settings);
    const boss = await login(service.app, owner);
    const ana = await login(service.app, "ana@gmail.com");
    await request(service.app).get("/api/admin/users").set("Cookie", ana).expect(403);
    await request(service.app).get("/api/admin/settings").set("Cookie", boss)
      .expect(200, { maxFileMb: 95, registration: "open" });
    await request(service.app).put("/api/admin/settings").set("Cookie", boss)
      .send({ maxFileMb: -1, registration: "open" }).expect(400);
    await request(service.app).put("/api/admin/settings").set("Cookie", boss)
      .send({ maxFileMb: 95, registration: "approval" }).expect(200);
    const pending = await google(service.app, "beto@gmail.com").expect(403);
    expect(pending.body.error).toContain("aprobación");
    const users = await request(service.app).get("/api/admin/users")
      .set("Cookie", boss).expect(200);
    expect(users.body.map((u: any) => [u.email, u.role, u.status])).toEqual([
      [owner, "owner", "active"],
      ["ana@gmail.com", "user", "active"],
      ["beto@gmail.com", "user", "pending"],
    ]);
    const beto = users.body[2].id,
      anaId = users.body[1].id;
    await request(service.app).patch(`/api/admin/users/${beto}`).set("Cookie", boss)
      .send({ status: "active" }).expect(200);
    const betoCookie = await login(service.app, "beto@gmail.com");
    // Bloquear invalida la sesión abierta sin esperar a que caduque el JWT.
    await request(service.app).get("/api/limits").set("Cookie", ana).expect(200);
    await request(service.app).patch(`/api/admin/users/${anaId}`).set("Cookie", boss)
      .send({ status: "blocked" }).expect(200);
    await request(service.app).get("/api/limits").set("Cookie", ana).expect(401);
    const blocked = await google(service.app, "ana@gmail.com").expect(403);
    expect(blocked.body.error).toContain("bloqueada");
    // El owner no se puede bloquear ni eliminar.
    await request(service.app).patch(`/api/admin/users/${users.body[0].id}`)
      .set("Cookie", boss).send({ status: "blocked" }).expect(400);
    await request(service.app).delete(`/api/admin/users/${users.body[0].id}`)
      .set("Cookie", boss).expect(400);
    // Eliminar un usuario borra sus trabajos y sus archivos.
    const job = await request(service.app).post("/api/jobs").set("Cookie", betoCookie)
      .attach("file", await pdf(), "beto.pdf").expect(202);
    await service.idle();
    await access(path.join(directory, job.body.job.id));
    await request(service.app).delete(`/api/admin/users/${beto}`).set("Cookie", boss).expect(204);
    expect(await store.getUser(beto)).toBeNull();
    expect(await store.get(job.body.job.id)).toBeNull();
    await expect(access(path.join(directory, job.body.job.id))).rejects.toThrow();
  });
  it("aplica el límite general y el límite propio de cada usuario", async () => {
    const service = createApp(new MemoryStore(), settings);
    const boss = await login(service.app, owner);
    const ana = await login(service.app, "ana@gmail.com");
    const limits = await request(service.app).get("/api/limits").set("Cookie", ana).expect(200);
    expect(limits.body).toEqual({ maxBytes: 95 * 1024 * 1024, maxPages: 500 });
    await request(service.app).put("/api/admin/settings").set("Cookie", boss)
      .send({ maxFileMb: 1, registration: "open" }).expect(200);
    const rejected = await request(service.app).post("/api/jobs").set("Cookie", ana)
      .attach("file", overOneMb(), "grande.pdf").expect(413);
    expect(rejected.body.error).toBe("El archivo supera 1 MB.");
    const users = await request(service.app).get("/api/admin/users").set("Cookie", boss);
    const anaId = users.body.find((u: any) => u.email === "ana@gmail.com").id;
    await request(service.app).patch(`/api/admin/users/${anaId}`).set("Cookie", boss)
      .send({ maxFileMb: 2 }).expect(200);
    expect((await request(service.app).get("/api/limits").set("Cookie", ana)).body.maxBytes)
      .toBe(2 * 1024 * 1024);
    await request(service.app).post("/api/jobs").set("Cookie", ana)
      .attach("file", overOneMb(), "grande.pdf").expect(202);
    // El owner sigue con el límite general.
    await request(service.app).post("/api/jobs").set("Cookie", boss)
      .attach("file", overOneMb(), "grande.pdf").expect(413);
    await request(service.app).patch(`/api/admin/users/${anaId}`).set("Cookie", boss)
      .send({ maxFileMb: null }).expect(200);
    await request(service.app).post("/api/jobs").set("Cookie", ana)
      .attach("file", overOneMb(), "grande.pdf").expect(413);
    await service.idle();
  });
});
describe("API de trabajos", () => {
  it("cada usuario ve solo sus trabajos, los renombra y el owner ve todos", async () => {
    const service = createApp(new MemoryStore(), settings);
    const boss = await login(service.app, owner);
    const ana = await login(service.app, "ana@gmail.com");
    const beto = await login(service.app, "beto@gmail.com");
    const mine = await request(service.app).post("/api/jobs").set("Cookie", ana)
      .attach("file", await pdf(), "Anexo 01.pdf").expect(202);
    await request(service.app).post("/api/jobs").set("Cookie", beto)
      .attach("file", await pdf(), "cv.pdf").expect(202);
    await service.idle();
    const id = mine.body.job.id;
    expect(mine.body.job.title).toBe("Anexo 01");
    const list = await request(service.app).get("/api/jobs").set("Cookie", ana).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({
      id, title: "Anexo 01", name: "Anexo 01.pdf", status: "ready", pages: 2, included: 2,
      owner: { email: "ana@gmail.com" },
    });
    expect(list.body[0].config).toBeUndefined();
    await request(service.app).get(`/api/jobs/${id}`).set("Cookie", beto).expect(404);
    await request(service.app).patch(`/api/jobs/${id}`).set("Cookie", beto)
      .send({ title: "Mío" }).expect(404);
    await request(service.app).get(`/api/jobs/${id}`).set("Cookie", boss).expect(200);
    const all = await request(service.app).get("/api/admin/jobs").set("Cookie", boss).expect(200);
    expect(all.body.map((j: any) => j.owner.email).sort())
      .toEqual(["ana@gmail.com", "beto@gmail.com"]);
    await request(service.app).patch(`/api/jobs/${id}`).set("Cookie", ana)
      .send({ title: "   " }).expect(400);
    const renamed = await request(service.app).patch(`/api/jobs/${id}`).set("Cookie", ana)
      .send({ title: "  CAS 003 " }).expect(200);
    expect(renamed.body).toMatchObject({ title: "CAS 003", revision: 1 });
    expect((await request(service.app).get("/api/jobs").set("Cookie", ana)).body[0].title)
      .toBe("CAS 003");
  });
  it("carga, autoriza, guarda, revisa, descarga idéntico e invalida tras editar", async () => {
    const store = new MemoryStore(),
      service = createApp(store, settings);
    const cookie = await login(service.app, "ana@gmail.com");
    const uploaded = await request(service.app)
      .post("/api/jobs")
      .set("Cookie", cookie)
      .attach("file", await pdf(), "ejemplo.pdf")
      .expect(202);
    const { id } = uploaded.body.job;
    await service.idle();
    await request(service.app).get(`/api/jobs/${id}`).expect(401);
    const loaded = await request(service.app)
      .get(`/api/jobs/${id}`)
      .set("Cookie", cookie)
      .expect(200);
    const config = loaded.body.config;
    config.prefix = "F-";
    const saved = await request(service.app)
      .put(`/api/jobs/${id}/config`)
      .set("Cookie", cookie)
      .send({ revision: 1, config })
      .expect(200);
    expect(saved.body.revision).toBe(2);
    await request(service.app)
      .put(`/api/jobs/${id}/config`)
      .set("Cookie", cookie)
      .send({ revision: 1, config })
      .expect(409);
    await request(service.app)
      .post(`/api/jobs/${id}/render`)
      .set("Cookie", cookie)
      .send({ revision: 2 })
      .expect(200);
    const preview = await request(service.app)
      .get(`/api/jobs/${id}/preview?revision=2`)
      .set("Cookie", cookie)
      .buffer(true)
      .parse(parseBinary)
      .expect(200);
    const download = await request(service.app)
      .get(`/api/jobs/${id}/download?revision=2`)
      .set("Cookie", cookie)
      .buffer(true)
      .parse(parseBinary)
      .expect(200);
    expect(preview.body.equals(download.body)).toBe(true);
    expect(download.headers["content-disposition"]).toContain(
      "ejemplo-foliado.pdf",
    );
    // Renombrar no invalida la revisión y cambia el nombre de la descarga.
    await request(service.app)
      .patch(`/api/jobs/${id}`)
      .set("Cookie", cookie)
      .send({ title: "CAS 003: Anexos" })
      .expect(200);
    const renamed = await request(service.app)
      .get(`/api/jobs/${id}/download?revision=2`)
      .set("Cookie", cookie)
      .expect(200);
    expect(renamed.headers["content-disposition"]).toContain(
      "CAS 003- Anexos-foliado.pdf",
    );
    await request(service.app)
      .get(`/api/jobs/${id}/download?revision=1`)
      .set("Cookie", cookie)
      .expect(409);
    await request(service.app)
      .put(`/api/jobs/${id}/config`)
      .set("Cookie", cookie)
      .send({ revision: 2, config })
      .expect(200);
    await request(service.app)
      .get(`/api/jobs/${id}/download?revision=2`)
      .set("Cookie", cookie)
      .expect(409);
    await request(service.app)
      .delete(`/api/jobs/${id}`)
      .set("Cookie", cookie)
      .expect(204);
    expect(await store.get(id)).toBeNull();
    await expect(access(path.join(directory, id))).rejects.toThrow();
  });
  it("rechaza extensión falsa, PDF dañado y páginas ajenas", async () => {
    const store = new MemoryStore(),
      service = createApp(store, settings);
    const cookie = await login(service.app, "ana@gmail.com");
    await request(service.app)
      .post("/api/jobs")
      .set("Cookie", cookie)
      .attach("file", Buffer.from("fake"), "test.pdf")
      .expect(400);
    const invalid = await request(service.app)
      .post("/api/jobs")
      .set("Cookie", cookie)
      .attach("file", Buffer.from("%PDF-damaged"), "test.pdf")
      .expect(202);
    await service.idle();
    expect((await store.get(invalid.body.job.id))?.status).toBe("failed");
    const valid = await request(service.app)
      .post("/api/jobs")
      .set("Cookie", cookie)
      .attach("file", await pdf(), "test.pdf")
      .expect(202);
    await service.idle();
    const job = (await store.get(valid.body.job.id))!;
    job.config!.pages[0].sourceIndex = 40;
    await request(service.app)
      .put(`/api/jobs/${job.id}/config`)
      .set("Cookie", cookie)
      .send({ revision: 1, config: job.config })
      .expect(400);
  });
  it("añade documentos al final conservando la edición existente", async () => {
    const store = new MemoryStore(),
      service = createApp(store, { ...settings, maxPages: 5 }, async () => pdf());
    const cookie = await login(service.app, "ana@gmail.com");
    const uploaded = await request(service.app)
      .post("/api/jobs")
      .set("Cookie", cookie)
      .attach("file", await pdf(), "base.pdf")
      .expect(202);
    const { id } = uploaded.body.job;
    await service.idle();
    const job = (await store.get(id))!;
    job.config!.pages[1].rotation = 90;
    await request(service.app)
      .put(`/api/jobs/${id}/config`)
      .set("Cookie", cookie)
      .send({ revision: 1, config: job.config })
      .expect(200);
    await request(service.app)
      .post(`/api/jobs/${id}/files?revision=1`)
      .set("Cookie", cookie)
      .attach("file", await pdf(), "extra.pdf")
      .expect(409);
    const added = await request(service.app)
      .post(`/api/jobs/${id}/files?revision=2`)
      .set("Cookie", cookie)
      .attach("file", Buffer.from("504b0304", "hex"), "extra.docx")
      .expect(200);
    expect(added.body.revision).toBe(3);
    expect(added.body.pages.map((p: any) => p.sourceIndex)).toEqual([0, 1, 2, 3]);
    expect(added.body.config.pages[1].rotation).toBe(90);
    expect(added.body.config.pages).toHaveLength(4);
    const source = await request(service.app)
      .get(`/api/jobs/${id}/source`)
      .set("Cookie", cookie)
      .buffer(true)
      .parse(parseBinary)
      .expect(200);
    expect((await PDFDocument.load(source.body)).getPageCount()).toBe(4);
    await request(service.app)
      .post(`/api/jobs/${id}/files?revision=3`)
      .set("Cookie", cookie)
      .attach("file", await pdf(), "extra.pdf")
      .expect(422);
    expect((await store.get(id))!.pages).toHaveLength(4);
    // Eliminar una página: la configuración conserva solo un subconjunto.
    const trimmed = { ...added.body.config, pages: added.body.config.pages.slice(1) };
    await request(service.app)
      .put(`/api/jobs/${id}/config`)
      .set("Cookie", cookie)
      .send({ revision: 3, config: trimmed })
      .expect(200);
    const inserted = await request(service.app)
      .post(`/api/jobs/${id}/files?revision=4&position=1`)
      .set("Cookie", cookie)
      .attach("file", await onePage(), "uno.pdf")
      .expect(200);
    expect(inserted.body.config.pages.map((p: any) => p.sourceIndex)).toEqual([1, 4, 2, 3]);
    const render = await request(service.app)
      .post(`/api/jobs/${id}/render`)
      .set("Cookie", cookie)
      .send({ revision: 5 })
      .expect(200);
    expect(render.body.status).toBe("review");
  });
  it("convierte DOC y DOCX secuencialmente y expone fallos recuperables", async () => {
    let active = 0,
      maxActive = 0;
    const store = new MemoryStore();
    const service = createApp(store, settings, async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      const bytes = await pdf();
      active--;
      return bytes;
    });
    const cookie = await login(service.app, "ana@gmail.com");
    for (const [name, magic] of [
      ["a.doc", "d0cf11e0a1b11ae1"],
      ["b.docx", "504b0304"],
    ])
      await request(service.app)
        .post("/api/jobs")
        .set("Cookie", cookie)
        .attach("file", Buffer.from(magic, "hex"), name)
        .expect(202);
    await service.idle();
    expect(maxActive).toBe(1);
    expect([...store.jobs.values()].every((j) => j.status === "ready")).toBe(true);
    const failed = createApp(store, settings, async () => {
      throw new Error("La conversión tardó demasiado.");
    });
    const upload = await request(failed.app)
      .post("/api/jobs")
      .set("Cookie", cookie)
      .attach("file", Buffer.from("504b0304", "hex"), "x.docx")
      .expect(202);
    await failed.idle();
    expect((await store.get(upload.body.job.id))?.error).toContain(
      "tardó demasiado",
    );
  });
  it("conserva los trabajos, recupera procesos interrumpidos y limpia carpetas huérfanas", async () => {
    const store = new MemoryStore(),
      service = createApp(store, settings);
    const cookie = await login(service.app, "ana@gmail.com");
    const upload = await request(service.app)
      .post("/api/jobs")
      .set("Cookie", cookie)
      .attach("file", await pdf(), "file.pdf")
      .expect(202);
    await service.idle();
    const id = upload.body.job.id;
    await store.update(id, { status: "rendering" });
    await service.recover();
    expect((await store.get(id))?.status).toBe("ready");
    await store.update(id, { status: "processing" });
    await service.recover();
    expect((await store.get(id))?.status).toBe("failed");
    const old = path.join(directory, randomUUID()),
      fresh = path.join(directory, randomUUID());
    await mkdir(old);
    await mkdir(fresh);
    const twoHoursAgo = new Date(Date.now() - 2 * 3600000);
    await utimes(old, twoHoursAgo, twoHoursAgo);
    await utimes(path.join(directory, id), twoHoursAgo, twoHoursAgo);
    await service.cleanup();
    await expect(access(old)).rejects.toThrow();
    await access(fresh);
    await access(path.join(directory, id));
    expect(await store.get(id)).not.toBeNull();
  });
});
