import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { spawnSync } from "node:child_process";
import { connect } from "node:net";
import path from "node:path";

const envPath = path.resolve("backend/.env");
if (!existsSync(envPath)) {
  console.error("Falta backend/.env. Ejecuta: Copy-Item backend/.env.example backend/.env");
  process.exit(1);
}
loadEnvFile(envPath);
if (!process.env.DATABASE_URL) {
  console.error("Falta DATABASE_URL en backend/.env.");
  process.exit(1);
}
let db;
try {
  db = new URL(process.env.DATABASE_URL);
  if (db.protocol !== "mysql:") throw new Error();
} catch {
  console.error("DATABASE_URL debe ser una URL mysql:// válida en backend/.env.");
  process.exit(1);
}
const port = Number(db.port || 3306);
const reachable = await new Promise((resolve) => {
  const socket = connect({ host: db.hostname, port, timeout: 2000 });
  socket.once("connect", () => { socket.destroy(); resolve(true); });
  socket.once("error", () => { socket.destroy(); resolve(false); });
  socket.once("timeout", () => { socket.destroy(); resolve(false); });
});
if (!reachable) {
  console.error(`MySQL no responde en ${db.hostname}:${port}. Inicia MySQL local (por ejemplo, desde Laragon) y vuelve a ejecutar pnpm dev.`);
  process.exit(1);
}
const office = process.env.SOFFICE_PATH || (process.platform === "win32" ? "C:\\Program Files\\LibreOffice\\program\\soffice.com" : "soffice");
if ((path.isAbsolute(office) && !existsSync(office)) || spawnSync(office, ["--headless", "--version"], { windowsHide: true, timeout: 20000 }).status !== 0) {
  console.error("LibreOffice no está disponible. Instálalo y ajusta SOFFICE_PATH en backend/.env.");
  process.exit(1);
}
console.log("MySQL y LibreOffice disponibles. Preparando la aplicación local...");
