import { PrismaClient, Prisma, type Job as DatabaseJob } from "@prisma/client";
import type { JobView } from "@folio/shared";

export type Job = JobView & { tokenHash: string };
export interface Store {
  create(job: Job): Promise<void>;
  get(id: string): Promise<Job | null>;
  update(id: string, patch: Partial<Job>): Promise<void>;
  delete(id: string): Promise<void>;
  all(): Promise<Job[]>;
}
export function prismaStore(db: PrismaClient): Store {
  const fromRow = (row: DatabaseJob): Job => ({
    ...row,
    kind: row.kind as Job["kind"],
    status: row.status as Job["status"],
    pages: row.pages as unknown as Job["pages"],
    config: row.config as unknown as Job["config"],
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  });
  const toRow = (job: Partial<Job>) => ({
    ...job,
    ...(job.createdAt ? { createdAt: new Date(job.createdAt) } : {}),
    ...(job.expiresAt ? { expiresAt: new Date(job.expiresAt) } : {}),
    ...(job.config === null ? { config: Prisma.DbNull } : {}),
  });
  return {
    async create(job) {
      await db.job.create({ data: toRow(job) as Prisma.JobCreateInput });
    },
    async get(id) {
      const row = await db.job.findUnique({ where: { id } });
      return row ? fromRow(row) : null;
    },
    async update(id, patch) {
      await db.job.update({
        where: { id },
        data: toRow(patch) as Prisma.JobUpdateInput,
      });
    },
    async delete(id) {
      await db.job.deleteMany({ where: { id } });
    },
    async all() {
      return (await db.job.findMany()).map(fromRow);
    },
  };
}
