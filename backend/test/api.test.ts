import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { mkdtemp, rm, access } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { PDFDocument } from "pdf-lib";
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
const parseBinary = (
  res: any,
  callback: (e: Error | null, data?: Buffer) => void,
) => {
  const chunks: Buffer[] = [];
  res.on("data", (data: Buffer) => chunks.push(data));
  res.on("end", () => callback(null, Buffer.concat(chunks)));
};
describe("API de trabajos", () => {
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
