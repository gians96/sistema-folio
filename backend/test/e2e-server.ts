// Test-only repository; the production entrypoint always uses MySQL.
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createApp } from "../src/app.js";
import { MemoryStore } from "./support.js";
const directory = await mkdtemp(path.join(os.tmpdir(), "folio-browser-"));
const service = createApp(new MemoryStore(), {
  dataDir: directory,
  maxBytes: 50 * 1024 * 1024,
  maxPages: 500,
  ttlMs: 86400000,
  conversionTimeout: 120000,
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
