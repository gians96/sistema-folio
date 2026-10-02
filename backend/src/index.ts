import { PrismaClient } from "@prisma/client";
import { loadEnvFile } from "node:process";
import { existsSync } from "node:fs";
import { createApp } from "./app.js";
import { prismaStore } from "./store.js";

const envFile = new URL("../.env", import.meta.url);
if (!existsSync(envFile) && !process.env.DATABASE_URL) {
  throw new Error("Falta backend/.env. Cópialo desde backend/.env.example y configura DATABASE_URL.");
}
if (existsSync(envFile)) loadEnvFile(envFile);
if (!process.env.DATABASE_URL) throw new Error("Falta DATABASE_URL en backend/.env.");
const db = new PrismaClient();
await db.$connect();
const service = createApp(prismaStore(db), {
  dataDir: process.env.DATA_DIR ?? "./data",
  maxBytes: Number(process.env.MAX_FILE_MB ?? 50) * 1024 * 1024,
  maxPages: Number(process.env.MAX_PAGES ?? 500),
  ttlMs: Number(process.env.JOB_TTL_HOURS ?? 24) * 3600000,
  conversionTimeout: Number(process.env.CONVERSION_TIMEOUT_MS ?? 120000),
  soffice: process.env.SOFFICE_PATH ?? (process.platform === "win32" ? "C:\\Program Files\\LibreOffice\\program\\soffice.com" : "soffice"),
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
