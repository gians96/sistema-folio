import { useEffect, useState, type FormEvent } from "react";
import { LoaderCircle, Trash2, X } from "lucide-react";
import type { AdminSettings, AdminUser, JobSummary, UserView } from "@folio/shared";
import { api } from "./api";
import { formatDate, statusLabels } from "./Dashboard";
import { Avatar } from "./Sidebar";

const userStatus: Record<AdminUser["status"], string> = {
  active: "Activo",
  pending: "Pendiente",
  blocked: "Bloqueado",
};
/** Límite propio de un usuario; vacío = límite general. */
function LimitInput({
  value,
  fallback,
  onSave,
}: {
  value: number | null;
  fallback: number;
  onSave: (mb: number | null) => Promise<boolean>;
}) {
  const shown = value === null ? "" : String(value);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  async function commit() {
    const mb = text.trim() === "" ? null : Number(text);
    if (mb === value) return;
    if (!(await onSave(mb))) setText(shown);
  }
  return (
    <input
      className="limit-input"
      type="number"
      min={0}
      max={2048}
      step={1}
      aria-label="Límite por archivo en MB"
      placeholder={`General (${fallback ? `${fallback} MB` : "sin límite"})`}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}

export function Admin({
  user,
  onJobsChanged,
}: {
  user: UserView;
  /** Avisa al menú lateral si se borró un trabajo propio. */
  onJobsChanged: () => void;
}) {
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [form, setForm] = useState({ maxFileMb: "", registration: "open" });
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    Promise.all([
      api<AdminSettings>("/admin/settings"),
      api<AdminUser[]>("/admin/users"),
      api<JobSummary[]>("/admin/jobs"),
    ])
      .then(([loaded, people, all]) => {
        setSettings(loaded);
        setForm({ maxFileMb: String(loaded.maxFileMb), registration: loaded.registration });
        setUsers(people);
        setJobs(all);
      })
      .catch((reason) => setError((reason as Error).message));
  }, []);
  function report(reason: unknown) {
    setNotice("");
    setError((reason as Error).message);
  }
  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const saved = await api<AdminSettings>("/admin/settings", {
        method: "PUT",
        body: JSON.stringify({
          maxFileMb: Number(form.maxFileMb),
          registration: form.registration,
        }),
      });
      setSettings(saved);
      setNotice("Configuración guardada.");
    } catch (reason) {
      report(reason);
    } finally {
      setSaving(false);
    }
  }
  async function patchUser(
    target: AdminUser,
    patch: { status?: "active" | "blocked"; maxFileMb?: number | null },
  ) {
    setError("");
    try {
      const updated = await api<UserView>(`/admin/users/${target.id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setUsers(
        (list) =>
          list &&
          list.map((item) => (item.id === target.id ? { ...updated, jobs: item.jobs } : item)),
      );
      return true;
    } catch (reason) {
      report(reason);
      return false;
    }
  }
  async function removeUser(target: AdminUser) {
    if (
      !confirm(
        `¿Eliminar la cuenta de ${target.email} y sus ${target.jobs} trabajos? Esta acción no se puede deshacer.`,
      )
    )
      return;
    setError("");
    try {
      await api(`/admin/users/${target.id}`, { method: "DELETE" });
      setUsers((list) => list && list.filter((item) => item.id !== target.id));
      setJobs((list) => list && list.filter((job) => job.userId !== target.id));
    } catch (reason) {
      report(reason);
    }
  }
  async function removeJob(job: JobSummary) {
    if (
      !confirm(
        `¿Eliminar "${job.title}" de ${job.owner.email}? Esta acción no se puede deshacer.`,
      )
    )
      return;
    setError("");
    try {
      await api(`/jobs/${job.id}`, { method: "DELETE" });
      setJobs((list) => list && list.filter((item) => item.id !== job.id));
      setUsers(
        (list) =>
          list &&
          list.map((item) => (item.id === job.userId ? { ...item, jobs: item.jobs - 1 } : item)),
      );
      if (job.userId === user.id) onJobsChanged();
    } catch (reason) {
      report(reason);
    }
  }
  return (
    <main>
      <div className="heading">
        <div>
          <div className="eyebrow">ADMINISTRACIÓN</div>
          <h1>Usuarios y configuración</h1>
          <p>Solo el propietario ({user.email}) ve esta sección.</p>
        </div>
      </div>
      {error && (
        <div role="alert" className="alert">
          <span>{error}</span>
          <button aria-label="Cerrar aviso" onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {notice && (
        <div role="status" className="notice success">
          {notice}
        </div>
      )}
      {!settings || !users || !jobs ? (
        !error && (
          <div className="loading-block">
            <LoaderCircle className="spin" size={26} />
          </div>
        )
      ) : (
        <>
          <section className="admin-section">
            <h2>Configuración</h2>
            <form className="admin-form" onSubmit={(event) => void saveSettings(event)}>
              <label>
                Tamaño máximo por archivo (MB)
                <input
                  type="number"
                  min={0}
                  max={2048}
                  step={1}
                  required
                  value={form.maxFileMb}
                  onChange={(e) => setForm({ ...form, maxFileMb: e.target.value })}
                />
                <small>
                  0 = sin límite. Con Cloudflare gratuito usa 95 o menos: rechaza las cargas
                  de más de 100 MB. Cada usuario puede tener su propio límite en la tabla.
                </small>
              </label>
              <label>
                Registro de usuarios nuevos
                <select
                  value={form.registration}
                  onChange={(e) => setForm({ ...form, registration: e.target.value })}
                >
                  <option value="open">Acceso inmediato</option>
                  <option value="approval">Requiere mi aprobación</option>
                </select>
                <small>Las cuentas pendientes aparecen abajo para que las apruebes.</small>
              </label>
              <button className="primary" disabled={saving}>
                {saving ? "Guardando…" : "Guardar configuración"}
              </button>
            </form>
          </section>
          <section className="admin-section">
            <h2>
              Usuarios <span className="count">{users.length}</span>
            </h2>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Usuario</th>
                    <th>Estado</th>
                    <th>Trabajos</th>
                    <th>Último acceso</th>
                    <th>Límite por archivo (MB)</th>
                    <th>
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <div className="person">
                          <Avatar user={item} />
                          <div>
                            <strong>{item.name}</strong>
                            <small>{item.email}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        {item.role === "owner" ? (
                          <span className="badge owner">Propietario</span>
                        ) : (
                          <span className={`badge user-${item.status}`}>
                            {userStatus[item.status]}
                          </span>
                        )}
                      </td>
                      <td>{item.jobs}</td>
                      <td>{item.lastLoginAt ? formatDate(item.lastLoginAt) : "—"}</td>
                      <td>
                        <LimitInput
                          value={item.maxFileMb}
                          fallback={settings.maxFileMb}
                          onSave={(mb) => patchUser(item, { maxFileMb: mb })}
                        />
                      </td>
                      <td>
                        {item.role !== "owner" && (
                          <div className="row-actions">
                            {item.status === "pending" && (
                              <button
                                className="text-button"
                                onClick={() => void patchUser(item, { status: "active" })}
                              >
                                Aprobar
                              </button>
                            )}
                            {item.status === "active" && (
                              <button
                                className="text-button"
                                onClick={() => void patchUser(item, { status: "blocked" })}
                              >
                                Bloquear
                              </button>
                            )}
                            {item.status === "blocked" && (
                              <button
                                className="text-button"
                                onClick={() => void patchUser(item, { status: "active" })}
                              >
                                Desbloquear
                              </button>
                            )}
                            <button
                              className="icon-button danger"
                              title="Eliminar usuario"
                              aria-label={`Eliminar a ${item.email}`}
                              onClick={() => void removeUser(item)}
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="admin-section">
            <h2>
              Trabajos de todos <span className="count">{jobs.length}</span>
            </h2>
            {jobs.length ? (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Trabajo</th>
                      <th>Usuario</th>
                      <th>Páginas</th>
                      <th>Estado</th>
                      <th>Actualizado</th>
                      <th>
                        <span className="sr-only">Acciones</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((job) => (
                      <tr key={job.id}>
                        <td>
                          <strong>{job.title}</strong>
                          <small>{job.name}</small>
                        </td>
                        <td>{job.owner.email}</td>
                        <td>{job.pages}</td>
                        <td>
                          <span className={`badge status-${job.status}`}>
                            {statusLabels[job.status]}
                          </span>
                        </td>
                        <td>{formatDate(job.updatedAt)}</td>
                        <td>
                          <div className="row-actions">
                            <a className="text-button" href={`#/trabajo/${job.id}`}>
                              Abrir
                            </a>
                            <button
                              className="icon-button danger"
                              title="Eliminar trabajo"
                              aria-label={`Eliminar ${job.title}`}
                              onClick={() => void removeJob(job)}
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty-text">Todavía no hay trabajos.</p>
            )}
          </section>
        </>
      )}
    </main>
  );
}
