import {
  PrismaClient,
  Prisma,
  type Job as DatabaseJob,
  type User as DatabaseUser,
} from "@prisma/client";
import type { JobSummary, JobView, UserView } from "@folio/shared";

export type Job = JobView;
export type User = UserView & { googleSub: string };
export type Owner = JobSummary["owner"];
export interface Store {
  create(job: Job): Promise<void>;
  get(id: string): Promise<Job | null>;
  update(id: string, patch: Partial<Job>): Promise<void>;
  delete(id: string): Promise<void>;
  /** Trabajos más recientes primero; sin userId, los de todos los usuarios. */
  list(userId?: string): Promise<(Job & { owner: Owner })[]>;
  ids(): Promise<string[]>;
  /** Trabajos que quedaron procesándose o generando la revisión. */
  unfinished(): Promise<Job[]>;
  userBySub(googleSub: string): Promise<User | null>;
  getUser(id: string): Promise<User | null>;
  createUser(user: User): Promise<void>;
  updateUser(id: string, patch: Partial<User>): Promise<void>;
  /** Borra también sus trabajos. */
  deleteUser(id: string): Promise<void>;
  users(): Promise<(User & { jobs: number })[]>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
}
export function prismaStore(db: PrismaClient): Store {
  const fromRow = (row: DatabaseJob): Job => ({
    ...row,
    kind: row.kind as Job["kind"],
    status: row.status as Job["status"],
    pages: row.pages as unknown as Job["pages"],
    config: row.config as unknown as Job["config"],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
  // updatedAt lo mantiene Prisma.
  const toRow = ({ updatedAt: _, ...job }: Partial<Job>) => ({
    ...job,
    ...(job.createdAt ? { createdAt: new Date(job.createdAt) } : {}),
    ...(job.config === null ? { config: Prisma.DbNull } : {}),
  });
  const fromUser = (row: DatabaseUser): User => ({
    ...row,
    role: row.role as User["role"],
    status: row.status as User["status"],
    createdAt: row.createdAt.toISOString(),
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
  });
  const toUser = (user: Partial<User>) => ({
    ...user,
    ...(user.createdAt ? { createdAt: new Date(user.createdAt) } : {}),
    ...(user.lastLoginAt ? { lastLoginAt: new Date(user.lastLoginAt) } : {}),
  });
  return {
    async create(job) {
      await db.job.create({
        data: toRow(job) as Prisma.JobUncheckedCreateInput,
      });
    },
    async get(id) {
      const row = await db.job.findUnique({ where: { id } });
      return row ? fromRow(row) : null;
    },
    async update(id, patch) {
      await db.job.update({
        where: { id },
        data: toRow(patch) as Prisma.JobUncheckedUpdateInput,
      });
    },
    async delete(id) {
      await db.job.deleteMany({ where: { id } });
    },
    async list(userId) {
      const rows = await db.job.findMany({
        where: userId ? { userId } : {},
        orderBy: { updatedAt: "desc" },
        include: { user: { select: { email: true, name: true } } },
      });
      return rows.map(({ user, ...row }) => ({ ...fromRow(row), owner: user }));
    },
    async ids() {
      const rows = await db.job.findMany({ select: { id: true } });
      return rows.map((row) => row.id);
    },
    async unfinished() {
      const rows = await db.job.findMany({
        where: { status: { in: ["processing", "rendering"] } },
      });
      return rows.map(fromRow);
    },
    async userBySub(googleSub) {
      const row = await db.user.findUnique({ where: { googleSub } });
      return row ? fromUser(row) : null;
    },
    async getUser(id) {
      const row = await db.user.findUnique({ where: { id } });
      return row ? fromUser(row) : null;
    },
    async createUser(user) {
      await db.user.create({ data: toUser(user) as Prisma.UserCreateInput });
    },
    async updateUser(id, patch) {
      await db.user.update({
        where: { id },
        data: toUser(patch) as Prisma.UserUpdateInput,
      });
    },
    async deleteUser(id) {
      await db.user.deleteMany({ where: { id } });
    },
    async users() {
      const rows = await db.user.findMany({
        orderBy: { createdAt: "asc" },
        include: { _count: { select: { jobs: true } } },
      });
      return rows.map(({ _count, ...row }) => ({
        ...fromUser(row),
        jobs: _count.jobs,
      }));
    },
    async getSetting(key) {
      return (await db.setting.findUnique({ where: { key } }))?.value ?? null;
    },
    async setSetting(key, value) {
      await db.setting.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      });
    },
  };
}
