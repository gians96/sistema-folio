// Test-only repository; the production entrypoint always uses MySQL.
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createApp } from "../src/app.js";
import { MemoryStore } from "./support.js";
import { scryptSync } from "node:crypto";
const directory = await mkdtemp(path.join(os.tmpdir(), "folio-browser-"));
const salt = Buffer.alloc(16, 3);
const service = createApp(new MemoryStore(), {
  dataDir: directory,
  maxBytes: 50 * 1024 * 1024,
  maxPages: 500,
  ttlMs: 86400000,
  conversionTimeout: 120000,
  auth: {
    username: "admin",
    passwordHash: `scrypt:${salt.toString("hex")}:${scryptSync("test-password-123", salt, 64).toString("hex")}`,
    sessionSecret: "test-only-secret-for-browser-integration-123",
    secureCookie: false,
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
