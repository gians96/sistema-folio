import { createHmac, scryptSync, timingSafeEqual } from "node:crypto";
import type { Express, Request, Response, NextFunction } from "express";

export type AuthSettings = {
  username: string;
  passwordHash: string;
  sessionSecret: string;
  secureCookie: boolean;
};

const cookieName = "folio_session";
const sessionMs = 8 * 60 * 60 * 1000;
const attemptWindowMs = 15 * 60 * 1000;

export function validPasswordHash(value: string) {
  return /^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(value);
}

export function passwordMatches(password: string, stored: string) {
  if (!validPasswordHash(stored)) return false;
  const [, salt, digest] = stored.split(":");
  const actual = scryptSync(password, Buffer.from(salt, "hex"), 64);
  return timingSafeEqual(actual, Buffer.from(digest, "hex"));
}

export function installAuth(
  app: Express,
  settings?: AuthSettings,
) {
  const failures = new Map<string, { count: number; until: number }>();
  if (settings) app.set("trust proxy", 2);
  const sign = (expires: string) =>
    createHmac("sha256", settings!.sessionSecret).update(expires).digest("hex");
  const authenticated = (req: Request) => {
    if (!settings) return true;
    const raw = req.headers.cookie
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);
    if (!raw) return false;
    const [expires, signature, extra] = raw.split(".");
    if (extra || !/^\d{13}$/.test(expires ?? "") || !/^[a-f0-9]{64}$/.test(signature ?? ""))
      return false;
    if (Number(expires) <= Date.now()) return false;
    return timingSafeEqual(Buffer.from(sign(expires)), Buffer.from(signature));
  };
  const sameOrigin = (req: Request) => {
    const origin = req.get("origin");
    if (!origin) return true;
    try {
      return new URL(origin).host === req.get("host");
    } catch {
      return false;
    }
  };
  const cookieOptions = (maxAge: number) => ({
    httpOnly: true,
    secure: settings?.secureCookie ?? false,
    sameSite: "strict" as const,
    path: "/api",
    maxAge,
  });

  app.get("/api/auth/session", (req: Request, res: Response) =>
    res.json({ enabled: !!settings, authenticated: authenticated(req) }),
  );
  app.post("/api/auth/login", (req: Request, res: Response) => {
    if (!settings) return res.json({ authenticated: true });
    if (!sameOrigin(req)) return res.status(403).json({ error: "Origen no permitido." });
    const key = req.ip ?? "unknown";
    const current = failures.get(key);
    if (current && current.until > Date.now() && current.count >= 5) {
      res.setHeader("Retry-After", String(Math.ceil((current.until - Date.now()) / 1000)));
      return res.status(429).json({ error: "Demasiados intentos. Intenta de nuevo en 15 minutos." });
    }
    const username = typeof req.body?.username === "string" ? req.body.username : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const passwordOk = password.length <= 500 && passwordMatches(password, settings.passwordHash);
    if (username.length > 200 || password.length > 500 ||
        username !== settings.username || !passwordOk) {
      const count = current && current.until > Date.now() ? current.count + 1 : 1;
      if (failures.size >= 10000) {
        for (const [address, attempt] of failures)
          if (attempt.until <= Date.now()) failures.delete(address);
        if (failures.size >= 10000) failures.delete(failures.keys().next().value!);
      }
      failures.set(key, { count, until: Date.now() + attemptWindowMs });
      return res.status(401).json({ error: "Usuario o contraseña incorrectos." });
    }
    failures.delete(key);
    const expires = String(Date.now() + sessionMs);
    res.cookie(cookieName, `${expires}.${sign(expires)}`, cookieOptions(sessionMs));
    return res.json({ authenticated: true });
  });
  app.post("/api/auth/logout", (req: Request, res: Response) => {
    if (settings && !sameOrigin(req)) return res.status(403).json({ error: "Origen no permitido." });
    res.clearCookie(cookieName, cookieOptions(0));
    return res.status(204).end();
  });
  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    if (!settings || req.path === "/health") return next();
    if (!authenticated(req)) return res.status(401).json({ error: "Inicia sesión para continuar." });
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !sameOrigin(req))
      return res.status(403).json({ error: "Origen no permitido." });
    return next();
  });
}
