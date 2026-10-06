import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { loadEnvFile } from "node:process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PDFDocument, StandardFonts } from "pdf-lib";

loadEnvFile(path.resolve("backend/.env"));
// La API exige sesión: valor de la cookie folio_session de una sesión iniciada en el navegador.
const session = process.env.FOLIO_SESSION;
if (!session) {
  console.error("Define FOLIO_SESSION con el valor de la cookie folio_session (DevTools > Aplicación > Cookies).");
  process.exit(1);
}
const office = process.env.SOFFICE_PATH || (process.platform === "win32" ? "C:\\Program Files\\LibreOffice\\program\\soffice.com" : "soffice");
const directory = path.resolve("tmp/local-smoke");
await mkdir(directory, { recursive: true });
const rtf = path.join(directory, "sample.rtf");
await writeFile(rtf, "{\\rtf1\\ansi\\deff0 Documento de prueba Word\\par Primera pagina.\\page Segunda pagina.\\par Fin.}");
const source = await PDFDocument.create();
const font = await source.embedFont(StandardFonts.Helvetica);
for (let i = 1; i <= 2; i++) source.addPage([595, 842]).drawText(`PRUEBA PDF ${i}`, { x: 70, y: 700, font, size: 20 });
await writeFile(path.join(directory, "sample.pdf"), await source.save());
for (const [ext, filter] of [["docx", "Office Open XML Text"], ["doc", "MS Word 97"]]) {
  const output = path.join(directory, ext);
  await mkdir(output, { recursive: true });
  const profile = path.join(directory, `lo-${ext}`);
  const result = spawnSync(office, [`-env:UserInstallation=${pathToFileURL(profile).href}`, "--headless", "--convert-to", `${ext}:${filter}`, "--outdir", output, rtf], { encoding: "utf8", windowsHide: true, timeout: 60000 });
  assert.equal(result.status, 0, `${ext}: ${result.error?.message ?? result.stderr}`);
  assert(existsSync(path.join(output, `sample.${ext}`)), `LibreOffice no generó ${ext}.`);
}
const api = "http://127.0.0.1:3001/api";
async function call(route, options = {}) {
  const response = await fetch(api + route, { ...options, headers: { Cookie: `folio_session=${session}`, ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...options.headers } });
  if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
  return response;
}
const jobs = [];
try {
  for (const ext of ["pdf", "docx", "doc"]) {
    const file = ext === "pdf" ? path.join(directory, "sample.pdf") : path.join(directory, ext, `sample.${ext}`);
    const form = new FormData();
    form.append("file", new Blob([await readFile(file)]), `sample.${ext}`);
    const { job: initial } = await (await call("/jobs", { method: "POST", body: form })).json();
    jobs.push(initial.id);
    let job = initial;
    const deadline = Date.now() + 120000;
    while (job.status === "processing" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      job = await (await call(`/jobs/${job.id}`)).json();
    }
    assert.equal(job.status, "ready", `${ext}: ${job.error || "La conversión no terminó."}`);
    assert.equal(job.pages.length, 2);
    job.config.prefix = "F-";
    const saved = await (await call(`/jobs/${job.id}/config`, { method: "PUT", body: JSON.stringify({ revision: job.revision, config: job.config }) })).json();
    const rendered = await (await call(`/jobs/${job.id}/render`, { method: "POST", body: JSON.stringify({ revision: saved.revision }) })).json();
    const preview = Buffer.from(await (await call(`/jobs/${job.id}/preview?revision=${rendered.revision}`)).arrayBuffer());
    const download = Buffer.from(await (await call(`/jobs/${job.id}/download?revision=${rendered.revision}`)).arrayBuffer());
    assert(preview.equals(download));
    assert.equal((await PDFDocument.load(download)).getPageCount(), 2);
    console.log(`OK ${ext.toUpperCase()}: carga, MySQL, foliación y descarga.`);
  }
} finally {
  for (const id of jobs) await call(`/jobs/${id}`, { method: "DELETE" }).catch(() => {});
}
