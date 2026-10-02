import { spawn } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function convertWord(
  input: string,
  directory: string,
  timeout: number,
  binary = "soffice",
): Promise<Uint8Array> {
  const output = path.join(directory, "converted");
  const profile = path.join(directory, "lo-profile");
  await mkdir(output, { recursive: true });
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        binary,
        [
          `-env:UserInstallation=${pathToFileURL(profile).href}`,
          "--headless",
          "--nologo",
          "--nodefault",
          "--nofirststartwizard",
          "--convert-to",
          "pdf:writer_pdf_Export",
          "--outdir",
          output,
          input,
        ],
        { stdio: "ignore", windowsHide: true },
      );
      let expired = false;
      const timer = setTimeout(() => {
        expired = true;
        child.kill("SIGKILL");
      }, timeout);
      child.on("error", () => {
        clearTimeout(timer);
        reject(
          new Error(
            "No se pudo iniciar LibreOffice. Verifica la instalación del conversor.",
          ),
        );
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (expired)
          reject(
            new Error(
              "La conversión tardó demasiado. Intenta con un documento más pequeño.",
            ),
          );
        else if (code !== 0)
          reject(new Error("LibreOffice no pudo convertir el documento."));
        else resolve();
      });
    });
    try {
      return await readFile(path.join(output, `${path.parse(input).name}.pdf`));
    } catch {
      throw new Error(
        "No se pudo convertir Word. Comprueba que el archivo no esté dañado ni tenga contraseña.",
      );
    }
  } finally {
    await rm(profile, { recursive: true, force: true });
    await rm(output, { recursive: true, force: true });
  }
}
