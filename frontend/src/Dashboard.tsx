import { useState } from "react";
import { FilePlus2, FileText, LoaderCircle, Search, Trash2, X } from "lucide-react";
import type { JobSummary, JobView, UserView } from "@folio/shared";
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
const relative = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
const units: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31536000],
  ["month", 2592000],
  ["week", 604800],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];
/** "hace 5 minutos", "ayer"… */
export function timeAgo(iso: string) {
  const seconds = (Date.parse(iso) - Date.now()) / 1000;
  for (const [unit, size] of units)
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  return "hace un momento";
}

export function Dashboard({
  user,
  jobs,
  error: loadError,
  onChanged,
}: {
  user: UserView;
  jobs: JobSummary[] | null;
  error: string;
  /** Vuelve a cargar la lista tras renombrar o eliminar. */
  onChanged: () => void;
}) {
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  async function rename(id: string, title: string) {
    setError("");
    try {
      await api<JobView>(`/jobs/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ title }),
      });
      onChanged();
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
      onChanged();
    } catch (reason) {
      setError((reason as Error).message);
    }
  }
  const words = query.trim().toLowerCase();
  const shown =
    jobs?.filter((job) => !words || `${job.title} ${job.name}`.toLowerCase().includes(words)) ??
    [];
  const message = error || (!jobs && loadError);
  return (
    <main>
      <div className="heading">
        <div>
          <div className="eyebrow">MIS TRABAJOS</div>
          <h1>Hola, {user.name.trim().split(/\s+/)[0]}</h1>
          <p>
            {!jobs
              ? "Cargando tus trabajos…"
              : jobs.length
                ? `Tienes ${jobs.length} ${jobs.length === 1 ? "trabajo guardado" : "trabajos guardados"}. Retoma uno o crea uno nuevo.`
                : "Crea tu primer trabajo para empezar."}
          </p>
        </div>
        <div className="heading-actions">
          {!!jobs?.length && (
            <label className="search">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                placeholder="Buscar trabajo…"
                aria-label="Buscar trabajo"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          )}
          <a className="primary" href="#/nuevo">
            <FilePlus2 size={17} /> Nuevo trabajo
          </a>
        </div>
      </div>
      {message && (
        <div role="alert" className="alert">
          <span>{message}</span>
          {error && (
            <button aria-label="Cerrar aviso" onClick={() => setError("")}>
              <X size={16} />
            </button>
          )}
        </div>
      )}
      {!jobs ? (
        !loadError && (
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
      ) : !shown.length ? (
        <p className="empty-text">No hay trabajos que coincidan con "{query.trim()}".</p>
      ) : (
        <div className="job-grid">
          {shown.map((job) => (
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
              <small className="job-date" title={formatDate(job.updatedAt)}>
                Actualizado {timeAgo(job.updatedAt)}
              </small>
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
