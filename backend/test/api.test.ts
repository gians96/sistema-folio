import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { mkdtemp, rm, access } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { PDFDocument } from "pdf-lib";
import { scryptSync } from "node:crypto";
import { createApp, type Settings } from "../src/app.js";
import { MemoryStore } from "./support.js";

let directory: string, settings: Settings;
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "folio-test-"));
  settings = {
    dataDir: directory,
    maxBytes: 1024 * 1024,
    maxPages: 500,
    ttlMs: 86400000,
    conversionTimeout: 500,
  };
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
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
const parseBinary = (
  res: any,
  callback: (e: Error | null, data?: Buffer) => void,
) => {
  const chunks: Buffer[] = [];
  res.on("data", (data: Buffer) => chunks.push(data));
  res.on("end", () => callback(null, Buffer.concat(chunks)));
};
describe("API de trabajos", () => {
  it("exige login privado, mantiene el token del trabajo y cierra sesión", async () => {
    const salt = Buffer.alloc(16, 7);
    const digest = scryptSync("una-contraseña-segura", salt, 64);
    const service = createApp(new MemoryStore(), {
      ...settings,
      auth: {
        username: "admin",
        passwordHash: `scrypt:${salt.toString("hex")}:${digest.toString("hex")}`,
        sessionSecret: "un-secreto-de-sesion-de-al-menos-32-caracteres",
        secureCookie: true,
      },
    });
    await request(service.app).get("/api/auth/session").expect(200, { enabled: true, authenticated: false });
    await request(service.app).get("/api/limits").expect(401);
    await request(service.app).post("/api/jobs").attach("file", await pdf(), "x.pdf").expect(401);
    await request(service.app).post("/api/auth/login").send({ username: "admin", password: "mal" }).expect(401);
    const login = await request(service.app)
      .post("/api/auth/login")
      .send({ username: "admin", password: "una-contraseña-segura" })
      .expect(200);
    const cookie = login.headers["set-cookie"][0].split(";")[0];
    expect(login.headers["set-cookie"][0]).toContain("HttpOnly");
    expect(login.headers["set-cookie"][0]).toContain("Secure");
    await request(service.app).get("/api/auth/session").set("Cookie", cookie)
      .expect(200, { enabled: true, authenticated: true });
    await request(service.app).post("/api/jobs").set("Cookie", cookie)
      .set("Origin", "https://otro-dominio.test")
      .attach("file", await pdf(), "x.pdf").expect(403);
    const uploaded = await request(service.app).post("/api/jobs")
      .set("Cookie", cookie).attach("file", await pdf(), "x.pdf").expect(202);
    await service.idle();
    await request(service.app).get(`/api/jobs/${uploaded.body.job.id}`)
      .set("Cookie", cookie).expect(404);
    await request(service.app).get(`/api/jobs/${uploaded.body.job.id}`)
      .set("Cookie", cookie)
      .set("Authorization", `Bearer ${uploaded.body.token}`).expect(200);
    await request(service.app).post("/api/auth/logout").set("Cookie", cookie).expect(204);
    await request(service.app).get("/api/limits").expect(401);
  });
  it("acepta el frontend de otro subdominio con CORS y rechaza los demás orígenes", async () => {
    const salt = Buffer.alloc(16, 5);
    const frontend = "https://folio.ejemplo.test";
    const service = createApp(new MemoryStore(), {
      ...settings,
      corsOrigins: [frontend],
      auth: {
        username: "admin",
        passwordHash: `scrypt:${salt.toString("hex")}:${scryptSync("test-password-123", salt, 64).toString("hex")}`,
        sessionSecret: "un-secreto-para-cors-de-al-menos-32-caracteres",
        secureCookie: true,
      },
    });
    const preflight = await request(service.app).options("/api/jobs")
      .set("Origin", frontend)
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "authorization")
      .expect(204);
    expect(preflight.headers["access-control-allow-origin"]).toBe(frontend);
    expect(preflight.headers["access-control-allow-credentials"]).toBe("true");
    expect(preflight.headers["access-control-allow-headers"]).toContain("Authorization");
    await request(service.app).options("/api/jobs")
      .set("Origin", "https://otro-dominio.test")
      .set("Access-Control-Request-Method", "POST")
      .expect(401);
    const login = await request(service.app).post("/api/auth/login")
      .set("Origin", frontend)
      .send({ username: "admin", password: "test-password-123" })
      .expect(200);
    expect(login.headers["access-control-allow-origin"]).toBe(frontend);
    const cookie = login.headers["set-cookie"][0].split(";")[0];
    const uploaded = await request(service.app).post("/api/jobs")
      .set("Origin", frontend).set("Cookie", cookie)
      .attach("file", await pdf(), "x.pdf").expect(202);
    expect(uploaded.headers["access-control-allow-origin"]).toBe(frontend);
    const other = await request(service.app).post("/api/jobs")
      .set("Origin", "https://otro-dominio.test").set("Cookie", cookie)
      .attach("file", await pdf(), "x.pdf").expect(403);
    expect(other.headers["access-control-allow-origin"]).toBeUndefined();
    await request(service.app).post("/api/auth/login")
      .set("Origin", "https://otro-dominio.test")
      .send({ username: "admin", password: "test-password-123" })
      .expect(403);
    await service.idle();
  });
  it("bloquea intentos reiterados y rechaza cookies modificadas", async () => {
    const salt = Buffer.alloc(16, 4);
    const service = createApp(new MemoryStore(), {
      ...settings,
      auth: {
        username: "admin",
        passwordHash: `scrypt:${salt.toString("hex")}:${scryptSync("test-password-123", salt, 64).toString("hex")}`,
        sessionSecret: "un-secreto-distinto-de-al-menos-32-caracteres",
        secureCookie: false,
      },
    });
    await request(service.app).get("/api/limits")
      .set("Cookie", "folio_session=9999999999999." + "0".repeat(64)).expect(401);
    for (let i = 0; i < 5; i++)
      await request(service.app).post("/api/auth/login")
        .send({ username: "admin", password: "incorrecta" }).expect(401);
    await request(service.app).post("/api/auth/login")
      .send({ username: "admin", password: "test-password-123" }).expect(429);
  });
  it("carga, autoriza, guarda, revisa, descarga idéntico e invalida tras editar", async () => {
    const store = new MemoryStore(),
      service = createApp(store, settings);
    const uploaded = await request(service.app)
      .post("/api/jobs")
      .attach("file", await pdf(), "ejemplo.pdf")
      .expect(202);
    const { id } = uploaded.body.job,
      token = uploaded.body.token;
    const auth = `Bearer ${token}`;
    await service.idle();
    await request(service.app).get(`/api/jobs/${id}`).expect(404);
    await request(service.app)
      .get(`/api/jobs/${id}/source`)
      .set("Authorization", "Bearer wrong")
      .expect(404);
    const loaded = await request(service.app)
      .get(`/api/jobs/${id}`)
      .set("Authorization", auth)
      .expect(200);
    expect(loaded.body.tokenHash).toBeUndefined();
    const config = loaded.body.config;
    config.prefix = "F-";
    const saved = await request(service.app)
      .put(`/api/jobs/${id}/config`)
      .set("Authorization", auth)
      .send({ revision: 1, config })
      .expect(200);
    expect(saved.body.revision).toBe(2);
    await request(service.app)
      .put(`/api/jobs/${id}/config`)
      .set("Authorization", auth)
      .send({ revision: 1, config })
      .expect(409);
    await request(service.app)
      .post(`/api/jobs/${id}/render`)
      .set("Authorization", auth)
      .send({ revision: 2 })
      .expect(200);
    const preview = await request(service.app)
      .get(`/api/jobs/${id}/preview?revision=2`)
      .set("Authorization", auth)
      .buffer(true)
      .parse(parseBinary)
      .expect(200);
    const download = await request(service.app)
      .get(`/api/jobs/${id}/download?revision=2`)
      .set("Authorization", auth)
      .buffer(true)
      .parse(parseBinary)
      .expect(200);
    expect(preview.body.equals(download.body)).toBe(true);
    expect(download.headers["content-disposition"]).toContain(
      "ejemplo-foliado.pdf",
    );
    await request(service.app)
      .get(`/api/jobs/${id}/download?revision=1`)
      .set("Authorization", auth)
      .expect(409);
    await request(service.app)
      .put(`/api/jobs/${id}/config`)
      .set("Authorization", auth)
      .send({ revision: 2, config })
      .expect(200);
    await request(service.app)
      .get(`/api/jobs/${id}/download?revision=2`)
      .set("Authorization", auth)
      .expect(409);
    await request(service.app)
      .delete(`/api/jobs/${id}`)
      .set("Authorization", auth)
      .expect(204);
    expect(await store.get(id)).toBeNull();
    await expect(access(path.join(directory, id))).rejects.toThrow();
  });
  it("rechaza extensión falsa, archivo grande, PDF dañado y páginas ajenas", async () => {
    const store = new MemoryStore(),
      service = createApp(store, { ...settings, maxBytes: 1500 });
    await request(service.app)
      .post("/api/jobs")
      .attach("file", Buffer.from("fake"), "test.pdf")
      .expect(400);
    await request(service.app)
      .post("/api/jobs")
      .attach("file", Buffer.alloc(2000), "test.pdf")
      .expect(400);
    const invalid = await request(service.app)
      .post("/api/jobs")
      .attach("file", Buffer.from("%PDF-damaged"), "test.pdf")
      .expect(202);
    await service.idle();
    expect((await store.get(invalid.body.job.id))?.status).toBe("failed");
    const valid = await request(service.app)
      .post("/api/jobs")
      .attach("file", await pdf(), "test.pdf")
      .expect(202);
    await service.idle();
    const job = (await store.get(valid.body.job.id))!;
    job.config!.pages[0].sourceIndex = 40;
    await request(service.app)
      .put(`/api/jobs/${job.id}/config`)
      .set("Authorization", `Bearer ${valid.body.token}`)
      .send({ revision: 1, config: job.config })
      .expect(400);
  });
  it("añade documentos al final conservando la edición existente", async () => {
    const store = new MemoryStore(),
      service = createApp(store, { ...settings, maxPages: 5 }, async () => pdf());
    const uploaded = await request(service.app)
      .post("/api/jobs")
      .attach("file", await pdf(), "base.pdf")
      .expect(202);
    const { id } = uploaded.body.job,
      auth = `Bearer ${uploaded.body.token}`;
    await service.idle();
    const job = (await store.get(id))!;
    job.config!.pages[1].rotation = 90;
    await request(service.app)
      .put(`/api/jobs/${id}/config`)
      .set("Authorization", auth)
      .send({ revision: 1, config: job.config })
      .expect(200);
    await request(service.app)
      .post(`/api/jobs/${id}/files?revision=1`)
      .set("Authorization", auth)
      .attach("file", await pdf(), "extra.pdf")
      .expect(409);
    const added = await request(service.app)
      .post(`/api/jobs/${id}/files?revision=2`)
      .set("Authorization", auth)
      .attach("file", Buffer.from("504b0304", "hex"), "extra.docx")
      .expect(200);
    expect(added.body.revision).toBe(3);
    expect(added.body.pages.map((p: any) => p.sourceIndex)).toEqual([0, 1, 2, 3]);
    expect(added.body.config.pages[1].rotation).toBe(90);
    expect(added.body.config.pages).toHaveLength(4);
    const source = await request(service.app)
      .get(`/api/jobs/${id}/source`)
      .set("Authorization", auth)
      .buffer(true)
      .parse(parseBinary)
      .expect(200);
    expect((await PDFDocument.load(source.body)).getPageCount()).toBe(4);
    await request(service.app)
      .post(`/api/jobs/${id}/files?revision=3`)
      .set("Authorization", auth)
      .attach("file", await pdf(), "extra.pdf")
      .expect(422);
    expect((await store.get(id))!.pages).toHaveLength(4);
    // Eliminar una página: la configuración conserva solo un subconjunto.
    const trimmed = { ...added.body.config, pages: added.body.config.pages.slice(1) };
    await request(service.app)
      .put(`/api/jobs/${id}/config`)
      .set("Authorization", auth)
      .send({ revision: 3, config: trimmed })
      .expect(200);
    const inserted = await request(service.app)
      .post(`/api/jobs/${id}/files?revision=4&position=1`)
      .set("Authorization", auth)
      .attach("file", await onePage(), "uno.pdf")
      .expect(200);
    expect(inserted.body.config.pages.map((p: any) => p.sourceIndex)).toEqual([1, 4, 2, 3]);
    const render = await request(service.app)
      .post(`/api/jobs/${id}/render`)
      .set("Authorization", auth)
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
    for (const [name, magic] of [
      ["a.doc", "d0cf11e0a1b11ae1"],
      ["b.docx", "504b0304"],
    ])
      await request(service.app)
        .post("/api/jobs")
        .attach("file", Buffer.from(magic, "hex"), name)
        .expect(202);
    await service.idle();
    expect(maxActive).toBe(1);
    expect((await store.all()).every((j) => j.status === "ready")).toBe(true);
    const failed = createApp(store, settings, async () => {
      throw new Error("La conversión tardó demasiado.");
    });
    const upload = await request(failed.app)
      .post("/api/jobs")
      .attach("file", Buffer.from("504b0304", "hex"), "x.docx")
      .expect(202);
    await failed.idle();
    expect((await store.get(upload.body.job.id))?.error).toContain(
      "tardó demasiado",
    );
  });
  it("expira trabajos, limpia archivos y recupera procesos interrumpidos", async () => {
    const store = new MemoryStore(),
      service = createApp(store, settings);
    const upload = await request(service.app)
      .post("/api/jobs")
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
    await store.update(id, { expiresAt: new Date(0).toISOString() });
    await request(service.app)
      .get(`/api/jobs/${id}`)
      .set("Authorization", `Bearer ${upload.body.token}`)
      .expect(410);
    await service.cleanup();
    expect(await store.get(id)).toBeNull();
    await expect(access(path.join(directory, id))).rejects.toThrow();
  });
});
