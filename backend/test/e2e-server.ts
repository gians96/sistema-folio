// Test-only repository; the production entrypoint always uses MySQL.
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createApp } from "../src/app.js";
import { MemoryStore } from "./support.js";
const directory = await mkdtemp(path.join(os.tmpdir(), "folio-browser-"));
const service = createApp(new MemoryStore(), {
  dataDir: directory,
  maxPages: 500,
  conversionTimeout: 120000,
  auth: {
    googleClientId: "e2e.apps.googleusercontent.com",
    ownerEmail: "owner@gmail.com",
    jwtSecret: Buffer.alloc(32, 3),
    secureCookie: false,
    // El botón de Google falso de las pruebas envía "sub|correo".
    verifyGoogle: async (credential) => {
      const [sub, email] = credential.split("|");
      if (!sub || !email) throw new Error("Credencial no válida.");
      return { sub, email, name: "Owner de prueba", picture: null, authoritative: true };
    },
  },
});
const server = service.app.listen(3101, "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(() => {
      void rm(directory, { recursive: true, force: true }).finally(() =>
        process.exit(),
      );
    }),
  );
