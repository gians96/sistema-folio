import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";

const base = process.env.SMOKE_API ?? "http://localhost:3001/api";
// La API exige sesión: valor de la cookie folio_session de una sesión iniciada en el navegador.
const session = process.env.FOLIO_SESSION;
assert(session, "Define FOLIO_SESSION con el valor de la cookie folio_session (DevTools > Aplicación > Cookies).");
const directory = path.resolve("tmp/docker-smoke");
await mkdir(directory, { recursive: true });
const docker = (...args) =>
  execFileSync("docker", ["compose", ...args], {
    encoding: "utf8",
    timeout: 180000,
  });
const container = docker("ps", "-q", "backend").trim();
assert(container, "Inicia Docker Compose antes de ejecutar esta prueba.");
const rtf =
  "{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Liberation Serif;}}\\f0\\fs32 Documento de prueba Word\\par Primera pagina.\\page Segunda pagina.\\par Fin del documento.}";
await writeFile(path.join(directory, "sample.rtf"), rtf);
docker("exec", "-T", "backend", "mkdir", "-p", "/tmp/folio-smoke");
execFileSync("docker", [
  "cp",
  path.join(directory, "sample.rtf"),
  `${container}:/tmp/folio-smoke/sample.rtf`,
]);
for (const [extension, filter] of [
  ["docx", "Office Open XML Text"],
  ["doc", "MS Word 97"],
]) {
  docker(
    "exec",
    "-T",
    "backend",
    "soffice",
    "-env:UserInstallation=file:///tmp/folio-smoke/profile",
    "--headless",
    "--convert-to",
    `${extension}:${filter}`,
    "--outdir",
    "/tmp/folio-smoke",
    "/tmp/folio-smoke/sample.rtf",
  );
  execFileSync("docker", [
    "cp",
    `${container}:/tmp/folio-smoke/sample.${extension}`,
    path.join(directory, `sample.${extension}`),
  ]);
}
const pdf = await PDFDocument.create(),
  font = await pdf.embedFont(StandardFonts.Helvetica);
for (const angle of [0, 90, 180, 270]) {
  const page = pdf.addPage([595, 842]);
  page.setRotation(degrees(angle));
  page.drawText(`PRUEBA DE INTEGRACION - ${angle}`, {
    x: 80,
    y: 700,
    size: 20,
    font,
  });
}
await writeFile(path.join(directory, "sample.pdf"), await pdf.save());
const jobs = [];
async function call(route, options = {}) {
  const response = await fetch(`${base}${route}`, {
    ...options,
    headers: {
      Cookie: `folio_session=${session}`,
      ...(options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...options.headers,
    },
  });
  if (!response.ok)
    throw new Error(`${response.status}: ${await response.text()}`);
  return response;
}
try {
  for (const extension of ["pdf", "docx", "doc"]) {
    const form = new FormData();
    form.append(
      "file",
      new Blob([await readFile(path.join(directory, `sample.${extension}`))]),
      `prueba.${extension}`,
    );
    const { job: initial } = await (
      await call("/jobs", { method: "POST", body: form })
    ).json();
    const id = initial.id;
    jobs.push(id);
    let job = initial;
    const deadline = Date.now() + 120000;
    while (job.status === "processing" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 300));
      job = await (await call(`/jobs/${id}`)).json();
    }
    assert.equal(
      job.status,
      "ready",
      job.error ?? "El procesamiento no terminó.",
    );
    assert.equal(job.pages.length, extension === "pdf" ? 4 : 2);
    const config = job.config;
    config.start = 10;
    config.prefix = "F-";
    config.digits = 3;
    config.pages[0].stamp = false;
    config.pages[1].position = {
      corner: "bottom-left",
      marginX: 12,
      marginY: 12,
    };
    const saved = await (
      await call(`/jobs/${id}/config`, {
        method: "PUT",
        body: JSON.stringify({ revision: job.revision, config }),
      })
    ).json();
    const rendered = await (
      await call(`/jobs/${id}/render`, {
        method: "POST",
        body: JSON.stringify({ revision: saved.revision }),
      })
    ).json();
    const preview = Buffer.from(
      await (
        await call(`/jobs/${id}/preview?revision=${rendered.revision}`)
      ).arrayBuffer(),
    );
    const download = Buffer.from(
      await (
        await call(`/jobs/${id}/download?revision=${rendered.revision}`)
      ).arrayBuffer(),
    );
    assert(preview.equals(download));
    assert.equal(
      (await PDFDocument.load(download)).getPageCount(),
      job.pages.length,
    );
    await writeFile(
      path.join(directory, `resultado-${extension}.pdf`),
      download,
    );
    console.log(
      `OK ${extension.toUpperCase()}: ${job.pages.length} páginas, persistencia MySQL, revisión y descarga idénticas.`,
    );
  }
  const timeoutResult = docker(
    "exec",
    "-T",
    "backend",
    "node",
    "--input-type=module",
    "-e",
    "import { convertWord } from './backend/dist/convert.js'; try { await convertWord('/tmp/folio-smoke/sample.docx', '/tmp/folio-smoke/timeout', 1); process.exit(1); } catch (e) { if (!e.message.includes('demasiado')) throw e; console.log('OK límite real de tiempo de LibreOffice'); }",
  );
  console.log(timeoutResult.trim());
} finally {
  for (const id of jobs)
    await call(`/jobs/${id}`, { method: "DELETE" });
}
console.log("Verificación Docker completada. Trabajos de prueba eliminados.");
