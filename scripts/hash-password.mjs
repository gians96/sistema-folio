import { randomBytes, scryptSync } from "node:crypto";

if (!process.stdin.isTTY) {
  console.error("Ejecuta este comando desde una terminal interactiva.");
  process.exit(1);
}

process.stdout.write("Contraseña de acceso: ");
process.stdin.setRawMode(true);
process.stdin.resume();
let password = "";
process.stdin.on("data", (chunk) => {
  for (const value of chunk.toString("utf8")) {
    if (value === "\r" || value === "\n") {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
      if (password.length < 12) {
        console.error("Usa una contraseña de al menos 12 caracteres.");
        process.exitCode = 1;
        return;
      }
      const salt = randomBytes(16);
      const digest = scryptSync(password, salt, 64);
      console.log(`scrypt:${salt.toString("hex")}:${digest.toString("hex")}`);
      password = "";
      return;
    }
    if (value === "\u0003") {
      process.stdin.setRawMode(false);
      process.exit(130);
    }
    if (value === "\u007f" || value === "\b") password = password.slice(0, -1);
    else if (value >= " ") password += value;
  }
});
