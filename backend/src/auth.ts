import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Express, Request, Response, NextFunction } from "express";
import { SignJWT, createRemoteJWKSet, jwtVerify } from "jose";
import type { UserView } from "@folio/shared";
import type { Store, User } from "./store.js";

export type GoogleProfile = {
  sub: string;
  email: string;
  name: string;
  picture: string | null;
  /** Google administra el correo (Gmail o Google Workspace). */
  authoritative: boolean;
};
export type GoogleVerifier = (credential: string) => Promise<GoogleProfile>;
export type AuthSettings = {
  googleClientId: string;
  /** Correo (en minúsculas) de la cuenta Google con control total. */
  ownerEmail: string;
  /** Clave de firma de los JWT de sesión. */
  jwtSecret: Uint8Array;
  secureCookie: boolean;
  verifyGoogle: GoogleVerifier;
};

const cookieName = "folio_session";
const sessionMs = 12 * 60 * 60 * 1000;

/** Verifica el ID token que entrega el botón "Acceder con Google". */
export function googleVerifier(clientId: string): GoogleVerifier {
  const keys = createRemoteJWKSet(
    new URL("https://www.googleapis.com/oauth2/v3/certs"),
  );
  return async (credential) => {
    const { payload } = await jwtVerify(credential, keys, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: clientId,
      algorithms: ["RS256"],
      clockTolerance: 60,
      requiredClaims: ["sub", "email"],
    });
    if (payload.email_verified !== true || typeof payload.email !== "string")
      throw new Error("Google no confirmó el correo de la cuenta.");
    const email = payload.email.toLowerCase();
    return {
      sub: payload.sub!,
      email,
      name:
        typeof payload.name === "string" && payload.name.trim()
          ? payload.name.trim()
          : email,
      picture: typeof payload.picture === "string" ? payload.picture : null,
      authoritative:
        email.endsWith("@gmail.com") || typeof payload.hd === "string",
    };
  };
}

/** Lee la clave de los JWT o la crea en DATA_DIR la primera vez. */
export async function loadJwtSecret(dataDir: string) {
  const file = path.join(path.resolve(dataDir), ".jwt-secret");
  try {
    const stored = Buffer.from((await readFile(file, "utf8")).trim(), "hex");
    if (stored.length >= 32) return stored;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(path.dirname(file), { recursive: true });
  const secret = randomBytes(32);
  const staged = `${file}.${process.pid}.tmp`;
  await writeFile(staged, secret.toString("hex"), { mode: 0o600 });
  await rename(staged, file);
  return secret;
}

/** Datos públicos del usuario; solo es owner si además coincide con OWNER_EMAIL. */
export function publicUser(
  { googleSub: _, ...user }: User,
  ownerEmail: string,
): UserView {
  return {
    ...user,
    role: user.role === "owner" && user.email === ownerEmail ? "owner" : "user",
  };
}

export function installAuth(
  app: Express,
  store: Store,
  settings: AuthSettings,
  allowedOrigins: ReadonlySet<string> = new Set(),
) {
  const view = (user: User) => publicUser(user, settings.ownerEmail);
  async function sessionUser(req: Request) {
    const token = req.headers.cookie
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);
    if (!token) return null;
    let id: string | undefined;
    try {
      ({
        payload: { sub: id },
      } = await jwtVerify(token, settings.jwtSecret, { algorithms: ["HS256"] }));
    } catch {
      return null;
    }
    // Se consulta en cada petición: un bloqueo surte efecto de inmediato.
    const user = id ? await store.getUser(id) : null;
    return user?.status === "active" ? user : null;
  }
  // Mismo host o un frontend declarado en CORS_ORIGINS (p. ej. otro subdominio).
  const sameOrigin = (req: Request) => {
    const origin = req.get("origin");
    if (!origin || allowedOrigins.has(origin)) return true;
    try {
      return new URL(origin).host === req.get("host");
    } catch {
      return false;
    }
  };
  const cookieOptions = (maxAge: number) => ({
    httpOnly: true,
    secure: settings.secureCookie,
    sameSite: "strict" as const,
    path: "/api",
    maxAge,
  });

  app.get("/api/auth/session", async (req: Request, res: Response) => {
    const user = await sessionUser(req);
    res.json({
      googleClientId: settings.googleClientId,
      user: user && view(user),
    });
  });
  app.post("/api/auth/google", async (req: Request, res: Response) => {
    if (!sameOrigin(req)) return res.status(403).json({ error: "Origen no permitido." });
    const credential =
      typeof req.body?.credential === "string" ? req.body.credential : "";
    if (!credential || credential.length > 8192)
      return res.status(400).json({ error: "Falta la credencial de Google." });
    let profile: GoogleProfile;
    try {
      profile = await settings.verifyGoogle(credential);
    } catch {
      return res.status(401).json({
        error: "No se pudo verificar tu cuenta de Google. Intenta de nuevo.",
      });
    }
    const owner = profile.authoritative && profile.email === settings.ownerEmail;
    const now = new Date().toISOString();
    let user = await store.userBySub(profile.sub);
    if (user) {
      const patch: Partial<User> = {
        email: profile.email,
        name: profile.name,
        picture: profile.picture,
        role: owner ? "owner" : "user",
        lastLoginAt: now,
        // El owner no puede quedar bloqueado ni pendiente.
        ...(owner && { status: "active" as const }),
      };
      await store.updateUser(user.id, patch);
      user = { ...user, ...patch };
    } else {
      const approval = (await store.getSetting("registration")) === "approval";
      user = {
        id: randomUUID(),
        googleSub: profile.sub,
        email: profile.email,
        name: profile.name,
        picture: profile.picture,
        role: owner ? "owner" : "user",
        status: owner || !approval ? "active" : "pending",
        maxFileMb: null,
        createdAt: now,
        lastLoginAt: now,
      };
      await store.createUser(user);
    }
    if (user.status === "blocked")
      return res.status(403).json({
        error: "Tu cuenta está bloqueada. Contacta al administrador.",
      });
    if (user.status === "pending")
      return res.status(403).json({
        error:
          "Tu cuenta quedó registrada y espera la aprobación del administrador.",
      });
    const token = await new SignJWT()
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user.id)
      .setIssuedAt()
      .setExpirationTime(Math.floor((Date.now() + sessionMs) / 1000))
      .sign(settings.jwtSecret);
    res.cookie(cookieName, token, cookieOptions(sessionMs));
    return res.json({ user: view(user) });
  });
  app.post("/api/auth/logout", (req: Request, res: Response) => {
    if (!sameOrigin(req)) return res.status(403).json({ error: "Origen no permitido." });
    res.clearCookie(cookieName, cookieOptions(0));
    return res.status(204).end();
  });
  app.use("/api", async (req: Request, res: Response, next: NextFunction) => {
    if (req.path === "/health") return next();
    const user = await sessionUser(req);
    if (!user) return res.status(401).json({ error: "Inicia sesión para continuar." });
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !sameOrigin(req))
      return res.status(403).json({ error: "Origen no permitido." });
    res.locals.user = view(user);
    return next();
  });
  app.use("/api/admin", (_req: Request, res: Response, next: NextFunction) => {
    if ((res.locals.user as UserView).role !== "owner")
      return res.status(403).json({ error: "Solo el propietario puede administrar." });
    return next();
  });
}
