import type { Job, Store, User } from "../src/store.js";
export class MemoryStore implements Store {
  jobs = new Map<string, Job>();
  accounts = new Map<string, User>();
  settings = new Map<string, string>();
  async create(job: Job) {
    this.jobs.set(
      job.id,
      structuredClone({ ...job, updatedAt: new Date().toISOString() }),
    );
  }
  async get(id: string) {
    return structuredClone(this.jobs.get(id) ?? null);
  }
  async update(id: string, patch: Partial<Job>) {
    const job = this.jobs.get(id);
    if (!job) throw new Error("Missing job");
    this.jobs.set(
      id,
      structuredClone({ ...job, ...patch, updatedAt: new Date().toISOString() }),
    );
  }
  async delete(id: string) {
    this.jobs.delete(id);
  }
  async list(userId?: string) {
    return structuredClone(
      [...this.jobs.values()]
        .filter((job) => !userId || job.userId === userId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((job) => {
          const owner = this.accounts.get(job.userId);
          return {
            ...job,
            owner: { email: owner?.email ?? "", name: owner?.name ?? "" },
          };
        }),
    );
  }
  async ids() {
    return [...this.jobs.keys()];
  }
  async unfinished() {
    return structuredClone(
      [...this.jobs.values()].filter((job) =>
        ["processing", "rendering"].includes(job.status),
      ),
    );
  }
  async userBySub(googleSub: string) {
    return structuredClone(
      [...this.accounts.values()].find((user) => user.googleSub === googleSub) ??
        null,
    );
  }
  async getUser(id: string) {
    return structuredClone(this.accounts.get(id) ?? null);
  }
  async createUser(user: User) {
    this.accounts.set(user.id, structuredClone(user));
  }
  async updateUser(id: string, patch: Partial<User>) {
    const user = this.accounts.get(id);
    if (!user) throw new Error("Missing user");
    this.accounts.set(id, structuredClone({ ...user, ...patch }));
  }
  async deleteUser(id: string) {
    this.accounts.delete(id);
    for (const [jobId, job] of this.jobs)
      if (job.userId === id) this.jobs.delete(jobId);
  }
  async users() {
    return structuredClone(
      [...this.accounts.values()].map((user) => ({
        ...user,
        jobs: [...this.jobs.values()].filter((job) => job.userId === user.id)
          .length,
      })),
    );
  }
  async getSetting(key: string) {
    return this.settings.get(key) ?? null;
  }
  async setSetting(key: string, value: string) {
    this.settings.set(key, value);
  }
}
