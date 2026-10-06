import { useEffect, useState } from "react";
import { FilePlus2, FileText, LoaderCircle, Trash2, X } from "lucide-react";
import type { JobSummary, JobView } from "@folio/shared";
import { api } from "./api";
import { EditableTitle } from "./EditableTitle";

export const statusLabels: Record<JobSummary["status"], string> = {
  processing: "Procesando",
  ready: "En edición",
  rendering: "Generando revisión",
  review: "Revisión lista",
  failed: "Con error",
};
export const formatDate = (iso: string) =>
  new Date(iso).toLocaleString("es", { dateStyle: "medium", timeStyle: "short" });

export function Dashboard() {
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<JobSummary[]>("/jobs")
      .then(setJobs)
      .catch((reason) => setError((reason as Error).message));
  }, []);
  async function rename(id: string, title: string) {
    setError("");
    try {
      const updated = await api<JobView>(`/jobs/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ title }),
      });
      setJobs((list) =>
        list && list.map((job) => (job.id === id ? { ...job, title: updated.title } : job)),
      );
    } catch (reason) {
      setError((reason as Error).message);
    }
  }
  async function remove(job: JobSummary) {
    if (!confirm(`¿Eliminar "${job.title}" y sus archivos? Esta acción no se puede deshacer.`))
      return;
    setError("");
    try {
      await api(`/jobs/${job.id}`, { method: "DELETE" });
      setJobs((list) => list && list.filter((item) => item.id !== job.id));
    } catch (reason) {
      setError((reason as Error).message);
    }
  }
  return (
    <main>
      <div className="heading">
        <div>
          <div className="eyebrow">MIS TRABAJOS</div>
          <h1>Tus documentos guardados</h1>
          <p>Cada trabajo conserva sus páginas y su foliación para que lo retomes cuando quieras.</p>
        </div>
        <a className="primary" href="#/nuevo">
          <FilePlus2 size={17} /> Nuevo trabajo
        </a>
      </div>
      {error && (
        <div role="alert" className="alert">
          <span>{error}</span>
          <button aria-label="Cerrar aviso" onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {!jobs ? (
        !error && (
          <div className="loading-block">
            <LoaderCircle className="spin" size={26} />
          </div>
        )
      ) : !jobs.length ? (
        <section className="upload-card">
          <div className="upload-icon">
            <FileText size={32} />
          </div>
          <h2>Aún no tienes trabajos</h2>
          <p>Crea uno para cada expediente, por ejemplo "CAS 003" o "CV completo".</p>
          <a className="primary" href="#/nuevo">
            <FilePlus2 size={18} /> Crear mi primer trabajo
          </a>
        </section>
      ) : (
        <div className="job-grid">
          {jobs.map((job) => (
            <article className="job-card" key={job.id}>
              <div className="job-head">
                <FileText size={22} />
                <div>
                  <EditableTitle value={job.title} onSave={(title) => rename(job.id, title)} />
                  <small title={job.name}>{job.name}</small>
                </div>
              </div>
              <div className="job-meta">
                <span className={`badge status-${job.status}`}>{statusLabels[job.status]}</span>
                <span>
                  {job.status === "processing" || job.status === "failed"
                    ? "—"
                    : `${job.pages} páginas · ${job.included} en el PDF`}
                </span>
              </div>
              <small className="job-date">Actualizado el {formatDate(job.updatedAt)}</small>
              <div className="job-actions">
                <a className="secondary" href={`#/trabajo/${job.id}`}>
                  Abrir
                </a>
                <button
                  className="icon-button danger"
                  title="Eliminar trabajo"
                  aria-label={`Eliminar ${job.title}`}
                  onClick={() => void remove(job)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
