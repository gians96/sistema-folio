import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// pdf.js necesita estos recursos para decodificar escaneos (JBIG2/CCITT, JPEG 2000),
// fuentes estándar no incrustadas y CMaps. Se sirven en /pdfjs/ en desarrollo
// y se copian al build de producción.
const pdfjsRoot = path.dirname(
  createRequire(import.meta.url).resolve("pdfjs-dist/package.json"),
);
const pdfjsFolders = ["wasm", "standard_fonts", "cmaps"];
function pdfjsAssets(): Plugin {
  return {
    name: "pdfjs-assets",
    configureServer(server) {
      server.middlewares.use("/pdfjs", (req, res, next) => {
        const [folder, file] = (req.url ?? "").split("?")[0].split("/").filter(Boolean);
        if (!pdfjsFolders.includes(folder) || !file || file.includes(".."))
          return next();
        try {
          const body = readFileSync(path.join(pdfjsRoot, folder, file));
          if (file.endsWith(".wasm")) res.setHeader("Content-Type", "application/wasm");
          else if (file.endsWith(".js")) res.setHeader("Content-Type", "text/javascript");
          res.end(body);
        } catch {
          next();
        }
      });
    },
    generateBundle() {
      for (const folder of pdfjsFolders)
        for (const file of readdirSync(path.join(pdfjsRoot, folder)))
          this.emitFile({
            type: "asset",
            fileName: `pdfjs/${folder}/${file}`,
            source: readFileSync(path.join(pdfjsRoot, folder, file)),
          });
    },
  };
}

export default defineConfig({
  plugins: [react(), pdfjsAssets()],
  server: {
    port: 5173,
    strictPort: true,
    // Google pide esta política para el botón de acceso en http://localhost.
    headers: { "Referrer-Policy": "no-referrer-when-downgrade" },
    proxy: {
      "/api": {
        target: process.env.API_PROXY ?? "http://localhost:3001",
        changeOrigin: false,
      },
    },
  },
});
