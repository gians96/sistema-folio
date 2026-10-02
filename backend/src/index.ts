import { PrismaClient } from "@prisma/client";
import { loadEnvFile } from "node:process";
import { existsSync } from "node:fs";
import { createApp } from "./app.js";
import { prismaStore } from "./store.js";
import { validPasswordHash, type AuthSettings } from "./auth.js";

const envFile = new URL("../.env", import.meta.url);
if (!existsSync(envFile) && !process.env.DATABASE_URL) {
  throw new Error("Falta backend/.env. Cópialo desde backend/.env.example y configura DATABASE_URL.");
}
if (existsSync(envFile)) loadEnvFile(envFile);
if (!process.env.DATABASE_URL) throw new Error("Falta DATABASE_URL en backend/.env.");
const production = process.env.NODE_ENV === "production";
const authVars = [process.env.ADMIN_USER, process.env.ADMIN_PASSWORD_HASH, process.env.SESSION_SECRET];
if (production && authVars.some((value) => !value))
  throw new Error("Faltan ADMIN_USER, ADMIN_PASSWORD_HASH o SESSION_SECRET para producción.");
if (authVars.some(Boolean) && authVars.some((value) => !value))
  throw new Error("Configura todas las variables de acceso privado o ninguna en desarrollo.");
if (process.env.ADMIN_PASSWORD_HASH && !validPasswordHash(process.env.ADMIN_PASSWORD_HASH))
  throw new Error("ADMIN_PASSWORD_HASH no tiene el formato scrypt esperado.");
if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length < 32)
  throw new Error("SESSION_SECRET debe tener al menos 32 caracteres.");
const auth: AuthSettings | undefined = authVars.every(Boolean) ? {
  username: process.env.ADMIN_USER!,
  passwordHash: process.env.ADMIN_PASSWORD_HASH!,
  sessionSecret: process.env.SESSION_SECRET!,
  secureCookie: production,
} : undefined;
const db = new PrismaClient();
await db.$connect();
const service = createApp(prismaStore(db), {
  dataDir: process.env.DATA_DIR ?? "./data",
  maxBytes: Number(process.env.MAX_FILE_MB ?? 50) * 1024 * 1024,
  maxPages: Number(process.env.MAX_PAGES ?? 500),
  ttlMs: Number(process.env.JOB_TTL_HOURS ?? 24) * 3600000,
  conversionTimeout: Number(process.env.CONVERSION_TIMEOUT_MS ?? 120000),
  soffice: process.env.SOFFICE_PATH ?? (process.platform === "win32" ? "C:\\Program Files\\LibreOffice\\program\\soffice.com" : "soffice"),
  auth,
});
await service.recover();
const timer = setInterval(() => service.cleanup().catch(console.error), 60000);
const server = service.app.listen(
  Number(process.env.PORT ?? 3001),
  "0.0.0.0",
  () => console.log("Folio API lista en :3001"),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    clearInterval(timer);
    server.close(() => {
      void service
        .idle()
        .finally(() => db.$disconnect())
        .finally(() => process.exit(0));
    });
  });
