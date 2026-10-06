import {
  FilePlus2,
  FolderOpen,
  Layers,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  X,
} from "lucide-react";
import type { JobSummary, UserView } from "@folio/shared";
import type { Route } from "./route";
import { statusLabels } from "./Dashboard";

export function Avatar({ user }: { user: Pick<UserView, "name" | "picture"> }) {
  return user.picture ? (
    <img className="avatar" src={user.picture} alt="" referrerPolicy="no-referrer" />
  ) : (
    <span className="avatar" aria-hidden="true">
      {user.name.trim().charAt(0).toUpperCase()}
    </span>
  );
}
export function Brand() {
  return (
    <a className="brand" href="#/" aria-label="Folio, mis trabajos">
      <span className="brand-icon">
        <Layers size={21} />
      </span>
      <span className="brand-text">
        folio<span className="brand-dot">.</span>
      </span>
    </a>
  );
}
/** Menú lateral: navegación, trabajos recientes y perfil. */
export function Sidebar({
  user,
  route,
  jobs,
  collapsed,
  onToggle,
  onClose,
  onLogout,
}: {
  user: UserView;
  route: Route;
  jobs: JobSummary[] | null;
  /** Solo iconos (en el editor, para dejarle espacio). */
  collapsed: boolean;
  onToggle: () => void;
  /** Cierra el menú en pantallas pequeñas. */
  onClose: () => void;
  onLogout: () => void;
}) {
  const current = route.view === "job" ? route.id : null;
  return (
    <aside className="sidebar" aria-label="Menú">
      <div className="sidebar-head">
        <Brand />
        <button
          className="icon-only sidebar-toggle"
          title={collapsed ? "Mostrar el menú" : "Contraer el menú"}
          aria-label={collapsed ? "Mostrar el menú" : "Contraer el menú"}
          onClick={onToggle}
        >
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
        <button className="icon-only sidebar-close" aria-label="Cerrar el menú" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <a className="primary sidebar-new" href="#/nuevo" title="Nuevo trabajo" aria-label="Nuevo trabajo">
        <FilePlus2 size={17} />
        <span className="label">Nuevo trabajo</span>
      </a>
      <nav className="side-nav" aria-label="Principal">
        <a
          className="side-link"
          href="#/"
          title="Mis trabajos"
          aria-label="Mis trabajos"
          aria-current={route.view === "home" ? "page" : undefined}
        >
          <FolderOpen size={18} />
          <span className="label">Mis trabajos</span>
          {jobs && (
            <span className="count" aria-hidden="true">
              {jobs.length}
            </span>
          )}
        </a>
        {user.role === "owner" && (
          <a
            className="side-link"
            href="#/admin"
            title="Administración"
            aria-label="Administración"
            aria-current={route.view === "admin" ? "page" : undefined}
          >
            <Settings size={18} />
            <span className="label">Administración</span>
          </a>
        )}
      </nav>
      <section className="side-recent" aria-labelledby="side-recent-title">
        <h2 className="side-title" id="side-recent-title">
          Recientes
        </h2>
        {jobs &&
          (jobs.length ? (
            <ul>
              {jobs.slice(0, 8).map((job) => (
                <li key={job.id}>
                  <a
                    className="side-link"
                    href={`#/trabajo/${job.id}`}
                    title={`${job.title} · ${statusLabels[job.status]}`}
                    aria-current={current === job.id ? "page" : undefined}
                  >
                    <span className={`status-dot status-${job.status}`} aria-hidden="true" />
                    <span className="label">{job.title}</span>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="side-empty">Aquí verás tus últimos trabajos.</p>
          ))}
      </section>
      <div className="side-user">
        <div className="side-profile" title={`${user.name} · ${user.email}`}>
          <Avatar user={user} />
          <div>
            <strong>{user.name}</strong>
            <small>{user.email}</small>
            <span className={`badge ${user.role === "owner" ? "owner" : "user-active"}`}>
              {user.role === "owner" ? "Propietario" : "Usuario"}
            </span>
          </div>
        </div>
        <button
          className="side-link side-logout"
          title="Cerrar sesión"
          aria-label="Cerrar sesión"
          onClick={onLogout}
        >
          <LogOut size={17} />
          <span className="label">Cerrar sesión</span>
        </button>
      </div>
    </aside>
  );
}
