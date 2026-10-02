import type { Job, Store } from "../src/store.js";
export class MemoryStore implements Store {
  jobs = new Map<string, Job>();
  async create(job: Job) {
    this.jobs.set(job.id, structuredClone(job));
  }
  async get(id: string) {
    return structuredClone(this.jobs.get(id) ?? null);
  }
  async update(id: string, patch: Partial<Job>) {
    const job = this.jobs.get(id);
    if (!job) throw new Error("Missing job");
    this.jobs.set(id, structuredClone({ ...job, ...patch }));
  }
  async delete(id: string) {
    this.jobs.delete(id);
  }
  async all() {
    return structuredClone([...this.jobs.values()]);
  }
}
