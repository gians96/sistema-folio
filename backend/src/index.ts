import { PrismaClient } from "@prisma/client";
import { loadEnvFile } from "node:process";
import { existsSync } from "node:fs";
import { createApp } from "./app.js";
import { prismaStore } from "./store.js";
import { googleVerifier, loadJwtSecret } from "./auth.js";

const envFile = new URL("../.env", import.meta.url);
if (!existsSync(envFile) && !process.env.DATABASE_URL) {
  throw new Error("Falta backend/.env. Cópialo desde backend/.env.example y configura DATABASE_URL.");
}
if (existsSync(envFile)) loadEnvFile(envFile);
if (!process.env.DATABASE_URL) throw new Error("Falta DATABASE_URL en backend/.env.");
const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim();
if (!googleClientId)
  throw new Error("Falta GOOGLE_CLIENT_ID: el ID de cliente OAuth de Google para iniciar sesión.");
const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
if (!ownerEmail || !/^[^\s@]+@[^\s@]+$/.test(ownerEmail))
  throw new Error("Falta OWNER_EMAIL: el correo de Google del propietario (p. ej. tu@gmail.com).");
const corsOrigins = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => {
    try {
      return new URL(value).origin;
    } catch {
      throw new Error(`CORS_ORIGINS no es válido: "${value}". Usa URLs completas, p. ej. https://folio.ejemplo.com.`);
    }
  });
const dataDir = process.env.DATA_DIR ?? "./data";
const db = new PrismaClient();
await db.$connect();
const service = createApp(prismaStore(db), {
  dataDir,
  maxPages: Number(process.env.MAX_PAGES ?? 500),
  conversionTimeout: Number(process.env.CONVERSION_TIMEOUT_MS ?? 120000),
  soffice: process.env.SOFFICE_PATH ?? (process.platform === "win32" ? "C:\\Program Files\\LibreOffice\\program\\soffice.com" : "soffice"),
  auth: {
    googleClientId,
    ownerEmail,
    jwtSecret: await loadJwtSecret(dataDir),
    secureCookie: process.env.NODE_ENV === "production",
    verifyGoogle: googleVerifier(googleClientId),
  },
  corsOrigins,
});
await service.recover();
const timer = setInterval(() => service.cleanup().catch(console.error), 3600000);
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
