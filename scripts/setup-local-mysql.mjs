import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { loadEnvFile } from "node:process";
import path from "node:path";

const envPath = path.resolve("backend/.env");
if (!existsSync(envPath)) {
  console.error("Copia backend/.env.example a backend/.env y revisa las credenciales.");
  process.exit(1);
}
loadEnvFile(envPath);
const url = new URL(process.env.DATABASE_URL ?? "");
const database = decodeURIComponent(url.pathname.slice(1));
const user = decodeURIComponent(url.username);
const password = decodeURIComponent(url.password);
if (url.protocol !== "mysql:" || !/^[A-Za-z][A-Za-z0-9_]*$/.test(database) || !/^[A-Za-z][A-Za-z0-9_]*$/.test(user) || !password || /['\\\r\n]/.test(password)) {
  console.error("DATABASE_URL debe indicar MySQL, un usuario y base simples, y una contraseña sin comillas ni barras invertidas.");
  process.exit(1);
}
const options = [process.env.MYSQL_PATH,
  "C:\\laragon\\bin\\mysql\\mysql-8.4.3-winx64\\bin\\mysql.exe",
  "C:\\Program Files\\MySQL\\MySQL Server 8.4\\bin\\mysql.exe",
  "mysql"];
const mysql = options.find((candidate) => candidate && (!path.isAbsolute(candidate) || existsSync(candidate)));
const sql = `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\nCREATE USER IF NOT EXISTS '${user}'@'localhost' IDENTIFIED BY '${password}';\nGRANT ALL PRIVILEGES ON \`${database}\`.* TO '${user}'@'localhost';\n`;
const result = spawnSync(mysql, ["--protocol=tcp", "-h", url.hostname, "-P", url.port || "3306", "-u", "root"], {
  input: sql, encoding: "utf8", windowsHide: true,
  env: { ...process.env, ...(process.env.LOCAL_MYSQL_ROOT_PASSWORD ? { MYSQL_PWD: process.env.LOCAL_MYSQL_ROOT_PASSWORD } : {}) },
});
if (result.error || result.status !== 0) {
  console.error("No se pudo crear la base y el usuario. Inicia MySQL y comprueba que root pueda conectarse por TCP. Puedes definir MYSQL_PATH y LOCAL_MYSQL_ROOT_PASSWORD en la sesión si son necesarios.");
  process.exit(1);
}
console.log(`Base '${database}' y usuario '${user}' listos en MySQL local.`);
