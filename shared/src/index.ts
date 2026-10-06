import { z } from "zod";

export const positionSchema = z
  .object({
    corner: z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]),
    marginX: z.number().min(0).max(100),
    marginY: z.number().min(0).max(100),
  })
  .strict();
export const pageSchema = z
  .object({
    id: z.string().min(1),
    sourceIndex: z.number().int().min(0),
    rotation: z.union([
      z.literal(0),
      z.literal(90),
      z.literal(180),
      z.literal(270),
    ]),
    included: z.boolean(),
    stamp: z.boolean(),
    position: positionSchema.nullable(),
  })
  .strict();
export const configSchema = z
  .object({
    start: z.number().int().min(0).max(999999999),
    direction: z.enum(["asc", "desc"]),
    prefix: z
      .string()
      .max(40)
      .regex(
        /^[\x20-\x7E\u00A0-\u00FF]*$/,
        "Usa caracteres latinos en el prefijo.",
      ),
    digits: z.number().int().min(1).max(12),
    size: z.number().min(6).max(72),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    position: positionSchema,
    pages: z.array(pageSchema).min(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    const count = value.pages.filter((p) => p.included).length;
    if (!count)
      ctx.addIssue({
        code: "custom",
        message: "Conserva al menos una página.",
      });
    if (value.direction === "desc" && value.start - count + 1 < 0)
      ctx.addIssue({
        code: "custom",
        message:
          "La secuencia descendente no puede producir números negativos.",
      });
    if (
      new Set(value.pages.map((p) => p.id)).size !== value.pages.length ||
      new Set(value.pages.map((p) => p.sourceIndex)).size !== value.pages.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Las páginas no pueden repetirse.",
      });
  });
export type Position = z.infer<typeof positionSchema>;
export type PageEdit = z.infer<typeof pageSchema>;
export type FolioConfig = z.infer<typeof configSchema>;
export type PageInfo = {
  id: string;
  sourceIndex: number;
  width: number;
  height: number;
  rotation: number;
};
export type JobStatus =
  | "processing"
  | "ready"
  | "rendering"
  | "review"
  | "failed";
export type JobView = {
  id: string;
  userId: string;
  /** Nombre del trabajo, editable (p. ej. "CAS 003"). */
  title: string;
  /** Nombre del primer archivo cargado. */
  name: string;
  kind: "pdf" | "doc" | "docx";
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  pages: PageInfo[];
  config: FolioConfig | null;
  revision: number;
  renderedRevision: number | null;
  error: string | null;
};
/** Trabajo resumido para los listados. */
export type JobSummary = Pick<
  JobView,
  | "id"
  | "userId"
  | "title"
  | "name"
  | "kind"
  | "status"
  | "createdAt"
  | "updatedAt"
  | "error"
> & {
  pages: number;
  included: number;
  owner: { email: string; name: string };
};
export type UserRole = "owner" | "user";
export type UserStatus = "active" | "pending" | "blocked";
export type UserView = {
  id: string;
  email: string;
  name: string;
  picture: string | null;
  role: UserRole;
  status: UserStatus;
  /** Límite propio por archivo; null = límite general. */
  maxFileMb: number | null;
  createdAt: string;
  lastLoginAt: string | null;
};
export type AdminUser = UserView & { jobs: number };
export type SessionView = { googleClientId: string; user: UserView | null };
export type Limits = { maxBytes: number; maxPages: number };
export const titleSchema = z
  .string()
  .trim()
  .min(1, "Escribe un nombre para el trabajo.")
  .max(120, "Usa como máximo 120 caracteres en el nombre.");
/** MB por archivo; 0 = sin límite. */
export const maxFileMbSchema = z
  .number()
  .int("Usa un número entero de MB.")
  .min(0, "El límite no puede ser negativo.")
  .max(2048, "El límite no puede superar 2048 MB.");
export const adminSettingsSchema = z
  .object({
    maxFileMb: maxFileMbSchema,
    registration: z.enum(["open", "approval"]),
  })
  .strict();
export type AdminSettings = z.infer<typeof adminSettingsSchema>;
export const userPatchSchema = z
  .object({
    status: z.enum(["active", "blocked"]).optional(),
    maxFileMb: maxFileMbSchema.nullable().optional(),
  })
  .strict();
export const defaultPosition: Position = {
  corner: "top-right",
  marginX: 10,
  marginY: 10,
};
export function defaultConfig(pages: PageInfo[]): FolioConfig {
  return {
    start: 1,
    direction: "asc",
    prefix: "",
    digits: 2,
    size: 12,
    color: "#000000",
    position: { ...defaultPosition },
    pages: pages.map((p) => ({
      id: p.id,
      sourceIndex: p.sourceIndex,
      rotation: 0,
      included: true,
      stamp: true,
      position: null,
    })),
  };
}
export function folios(config: FolioConfig): Map<string, string> {
  let index = 0;
  const labels = new Map<string, string>();
  for (const page of config.pages) {
    if (!page.included) continue;
    const n = config.start + index++ * (config.direction === "asc" ? 1 : -1);
    if (page.stamp)
      labels.set(
        page.id,
        config.prefix + String(n).padStart(Math.max(2, config.digits), "0"),
      );
  }
  return labels;
}
export const MM_TO_PT = 72 / 25.4;
