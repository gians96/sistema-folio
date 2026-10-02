import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileCheck2,
  FileText,
  Layers,
  LoaderCircle,
  RotateCw,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  UploadCloud,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  configSchema,
  defaultConfig,
  folios,
  type FolioConfig,
  type JobView,
  type PageEdit,
  type Position,
} from "@folio/shared";
import { api, type Session } from "./api";
import { PdfPage, usePdf } from "./PdfView";

const corners: [Position["corner"], string, string][] = [
  ["top-left", "Superior izquierda", "↖"],
  ["top-right", "Superior derecha", "↗"],
  ["bottom-left", "Inferior izquierda", "↙"],
  ["bottom-right", "Inferior derecha", "↘"],
];
function PositionControls({
  value,
  onChange,
}: {
  value: Position;
  onChange: (p: Position) => void;
}) {
  return (
    <>
      <div className="corner-grid">
        {corners.map(([corner, name, arrow]) => (
          <button
            type="button"
            key={corner}
            className={value.corner === corner ? "selected" : ""}
            onClick={() => onChange({ ...value, corner })}
            aria-label={name}
            aria-pressed={value.corner === corner}
          >
            <span>{arrow}</span>
            {name}
          </button>
        ))}
      </div>
      <div className="fields">
        <label>
          Margen horizontal <span>mm</span>
          <input
            type="number"
            min="0"
            max="100"
            value={value.marginX}
            onChange={(e) =>
              onChange({ ...value, marginX: Number(e.target.value) })
            }
          />
        </label>
        <label>
          Margen vertical <span>mm</span>
          <input
            type="number"
            min="0"
            max="100"
            value={value.marginY}
            onChange={(e) =>
              onChange({ ...value, marginY: Number(e.target.value) })
            }
          />
        </label>
      </div>
    </>
  );
}
function initialSession(): Session | null {
  try {
    return JSON.parse(sessionStorage.getItem("folio-session") ?? "null");
  } catch {
    return null;
  }
}
export default function App() {
  const [session, setSession] = useState<Session | null>(initialSession);
  const [job, setJob] = useState<JobView | null>(null);
  const [config, setConfig] = useState<FolioConfig | null>(null);
  const [source, setSource] = useState<ArrayBuffer | null>(null);
  const [review, setReview] = useState<ArrayBuffer | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [mode, setMode] = useState<"edit" | "review">("edit");
  const [reviewIndex, setReviewIndex] = useState(0);
  const [reviewReady, setReviewReady] = useState(false);
  const [zoom, setZoom] = useState(80);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [limits, setLimits] = useState({
    maxBytes: 50 * 1024 * 1024,
    maxPages: 500,
    ttlHours: 24,
  });
  const fileInput = useRef<HTMLInputElement>(null);
  const sourcePdf = usePdf(source),
    reviewPdf = usePdf(review);
  useEffect(() => {
    api<typeof limits>("/limits")
      .then(setLimits)
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!session) {
      sessionStorage.removeItem("folio-session");
      return;
    }
    sessionStorage.setItem("folio-session", JSON.stringify(session));
    let cancelled = false,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await api<JobView>(`/jobs/${session.id}`, session);
        if (cancelled) return;
        setJob(result);
        if (result.status === "processing") {
          timer = setTimeout(poll, 1000);
          return;
        }
        if (result.config) {
          setConfig({ ...result.config, digits: Math.max(2, result.config.digits) });
          setSelected(result.config.pages[0].id);
          setDirty(result.config.digits < 2);
          const bytes = await api<ArrayBuffer>(
            `/jobs/${session.id}/source`,
            session,
          );
          if (!cancelled) setSource(bytes);
        }
        if (result.error) setError(result.error);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [session]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);
  async function upload(file?: File) {
    if (!file || busy) return;
    setError("");
    if (!/\.(pdf|docx?)$/i.test(file.name)) {
      setError("Selecciona un archivo PDF, DOC o DOCX.");
      return;
    }
    if (file.size > limits.maxBytes) {
      setError(`El archivo supera ${limits.maxBytes / 1024 / 1024} MB.`);
      return;
    }
    setBusy("Cargando documento…");
    try {
      const form = new FormData();
      form.append("file", file);
      const result = await api<{ job: JobView; token: string }>("/jobs", null, {
        method: "POST",
        body: form,
      });
      setJob(result.job);
      setConfig(null);
      setSource(null);
      setReview(null);
      setDirty(false);
      setMode("edit");
      setSession({ id: result.job.id, token: result.token });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  function change(next: FolioConfig) {
    setConfig(next);
    setDirty(true);
    setReview(null);
    setMode("edit");
    setError("");
  }
  function patchPage(patch: Partial<PageEdit>) {
    if (config)
      change({
        ...config,
        pages: config.pages.map((p) =>
          p.id === selected ? { ...p, ...patch } : p,
        ),
      });
  }
  function move(delta: number) {
    if (!config) return;
    const pages = [...config.pages],
      i = pages.findIndex((p) => p.id === selected),
      target = i + delta;
    if (target < 0 || target >= pages.length) return;
    [pages[i], pages[target]] = [pages[target], pages[i]];
    change({ ...config, pages });
  }
  async function save(): Promise<JobView | null> {
    if (!session || !job || !config) return null;
    const validation = configSchema.safeParse(config);
    if (!validation.success)
      throw new Error(validation.error.issues.map((i) => i.message).join(" "));
    const updated = await api<JobView>(`/jobs/${session.id}/config`, session, {
      method: "PUT",
      body: JSON.stringify({ revision: job.revision, config }),
    });
    setJob(updated);
    setDirty(false);
    return updated;
  }
  async function generate() {
    if (!session || !config) return;
    setBusy("Preparando revisión…");
    setError("");
    setReview(null);
    setReviewReady(false);
    try {
      const saved = await save();
      if (!saved) return;
      const result = await api<JobView>(`/jobs/${session.id}/render`, session, {
        method: "POST",
        body: JSON.stringify({ revision: saved.revision }),
      });
      setJob(result);
      const bytes = await api<ArrayBuffer>(
        `/jobs/${session.id}/preview?revision=${result.revision}`,
        session,
      );
      setReview(bytes);
      setReviewIndex(0);
      setMode("review");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function download() {
    if (!session || !job || !review || dirty) return;
    setBusy("Descargando…");
    setError("");
    try {
      const bytes = await api<ArrayBuffer>(
        `/jobs/${session.id}/download?revision=${job.revision}`,
        session,
      );
      const url = URL.createObjectURL(
        new Blob([bytes], { type: "application/pdf" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `${job.name.replace(/\.[^.]+$/, "")}-foliado.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function remove() {
    if (
      !session ||
      !confirm(
        "¿Eliminar este trabajo y sus archivos? Esta acción no se puede deshacer.",
      )
    )
      return;
    setBusy("Eliminando…");
    try {
      await api(`/jobs/${session.id}`, session, { method: "DELETE" });
      reset();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  function reset() {
    setSession(null);
    setJob(null);
    setConfig(null);
    setSource(null);
    setReview(null);
    setDirty(false);
    setError("");
    setMode("edit");
  }
  const page = config?.pages.find((p) => p.id === selected);
  const pageIndex = config?.pages.findIndex((p) => p.id === selected) ?? 0;
  const included = config?.pages.filter((p) => p.included).length ?? 0;
  const labels = config ? folios(config) : new Map<string, string>();
  const validation = config ? configSchema.safeParse(config) : null;
  const canDownload = !!review && !!reviewPdf.doc && reviewReady && !dirty;
  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Folio, inicio">
          <span className="brand-icon">
            <Layers size={23} />
          </span>
          folio<span className="brand-dot">.</span>
        </a>
        <span className="topbar-divider" />
        <span className="tagline">Cada página, en su lugar.</span>
        <div className="local-badge">
          <span />
          Espacio de trabajo local
        </div>
      </header>
      <main>
        <div className="heading">
          <div>
            <div className="eyebrow">HERRAMIENTAS DE DOCUMENTOS</div>
            <h1>Foliar documentos</h1>
            <p>Organiza tus páginas. Añade los folios. Deja todo en orden.</p>
          </div>
          <div className="privacy">
            <ShieldCheck size={19} />
            <span>
              Archivos temporales
              <br />
              <strong>Se eliminan en {limits.ttlHours} horas</strong>
            </span>
          </div>
        </div>
        <nav className="steps" aria-label="Progreso">
          <span className={!job ? "active" : "done"}>
            <b>{job ? <Check size={13} /> : "1"}</b>Carga tu documento
          </span>
          <i />
          <span
            className={
              config && mode === "edit"
                ? "active"
                : mode === "review"
                  ? "done"
                  : ""
            }
          >
            <b>2</b>Organiza y folia
          </span>
          <i />
          <span className={mode === "review" ? "active" : ""}>
            <b>3</b>Revisa y descarga
          </span>
        </nav>
        {(error || sourcePdf.error || reviewPdf.error) && (
          <div role="alert" className="alert">
            <span>{error || sourcePdf.error || reviewPdf.error}</span>
            <button aria-label="Cerrar aviso" onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
        <input
          ref={fileInput}
          type="file"
          accept=".pdf,.doc,.docx"
          className="sr-only"
          aria-label="Seleccionar documento"
          onChange={(e) => void upload(e.target.files?.[0])}
        />
        {!session ? (
          <>
            <section
              className={`upload-card ${dragging ? "dragging" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                if (e.dataTransfer.files.length > 1)
                  setError("Carga un solo documento por trabajo.");
                else void upload(e.dataTransfer.files[0]);
              }}
            >
              <div className="upload-icon">
                <UploadCloud size={34} />
              </div>
              <h2>Todo empieza con un documento</h2>
              <p>Arrastra tu archivo aquí o selecciónalo desde tu equipo.</p>
              <button
                className="primary"
                disabled={!!busy}
                onClick={() => fileInput.current?.click()}
              >
                {busy ? (
                  <LoaderCircle className="spin" size={18} />
                ) : (
                  <UploadCloud size={18} />
                )}{" "}
                {busy || "Seleccionar documento"}
              </button>
              <div className="file-types">
                <span>PDF</span>
                <span>DOC</span>
                <span>DOCX</span>
                <i />
                Hasta {limits.maxBytes / 1024 / 1024} MB · {limits.maxPages}{" "}
                páginas
              </div>
            </section>
            <div className="benefits">
              <article>
                <span>01</span>
                <h3>A tu manera</h3>
                <p>
                  Elige la esquina, el formato y el número de inicio de tus
                  folios.
                </p>
              </article>
              <article>
                <span>02</span>
                <h3>Sin sorpresas</h3>
                <p>Revisa cada página antes de descargar el PDF definitivo.</p>
              </article>
              <article>
                <span>03</span>
                <h3>El original, intacto</h3>
                <p>
                  Trabajamos sobre una copia. Tu documento original se conserva.
                </p>
              </article>
            </div>
          </>
        ) : !config ? (
          <section className="processing">
            <div className="upload-icon">
              {job?.status === "failed" ? (
                <FileText size={32} />
              ) : (
                <LoaderCircle className="spin" size={32} />
              )}
            </div>
            <h2>
              {job?.status === "failed"
                ? "No pudimos preparar el documento"
                : "Preparando tu documento"}
            </h2>
            <p>{job?.name}</p>
            <p>
              {job?.status === "failed"
                ? "Comprueba el archivo y vuelve a cargarlo."
                : "Estamos leyendo las páginas. Los archivos Word se convierten a PDF."}
            </p>
            <button className="secondary" disabled={!!busy} onClick={reset}>
              Volver a cargar
            </button>
          </section>
        ) : (
          <>
            <div className="document-bar">
              <div className="document-name">
                <FileText size={24} />
                <div>
                  <strong title={job?.name}>{job?.name}</strong>
                  <small>
                    {config.pages.length} páginas originales · {included} en el
                    PDF final
                  </small>
                </div>
              </div>
              <div className="document-actions">
                <span className="save-state">
                  {dirty ? "Cambios sin guardar" : "Edición guardada"}
                </span>
                <button
                  className="text-button"
                  disabled={!!busy}
                  onClick={() => {
                    if (
                      !dirty ||
                      confirm(
                        "¿Abrir otro documento y dejar los cambios sin guardar?",
                      )
                    )
                      reset();
                  }}
                >
                  Nuevo documento
                </button>
                <button
                  className="text-button"
                  disabled={!!busy || !dirty}
                  onClick={async () => {
                    setBusy("Guardando…");
                    try {
                      await save();
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy("");
                    }
                  }}
                >
                  Guardar
                </button>
                <button
                  className="icon-button danger"
                  title="Eliminar trabajo"
                  aria-label="Eliminar trabajo"
                  disabled={!!busy}
                  onClick={() => void remove()}
                >
                  <Trash2 size={17} />
                </button>
              </div>
            </div>
            {job?.kind !== "pdf" && (
              <div className="notice">
                Word convertido a PDF. Revisa la distribución y las fuentes
                antes de continuar.
              </div>
            )}
            <div className="editor">
              <aside className="pages-panel">
                <div className="panel-heading">
                  <h2>Páginas</h2>
                  <span>
                    {mode === "review" ? included : config.pages.length}
                  </span>
                </div>
                <div className="thumbnail-list">
                  {(mode === "review"
                    ? config.pages.filter((p) => p.included)
                    : config.pages
                  ).map((p, i) => (
                    <button
                      key={p.id}
                      disabled={!!busy}
                      className={`thumbnail ${mode === "review" ? (reviewIndex === i ? "current" : "") : selected === p.id ? "current" : ""} ${!p.included ? "excluded" : ""}`}
                      onClick={() =>
                        mode === "review"
                          ? setReviewIndex(i)
                          : setSelected(p.id)
                      }
                      aria-label={`Página original ${p.sourceIndex + 1}`}
                    >
                      {sourcePdf.doc && (
                        <PdfPage
                          doc={sourcePdf.doc}
                          index={p.sourceIndex}
                          rotation={p.rotation}
                          width={102}
                          edit={p}
                          config={config}
                          label={labels.get(p.id)}
                        />
                      )}
                      <span>
                        Pág. {p.sourceIndex + 1}
                        <small>
                          {!p.included
                            ? "Excluida"
                            : !p.stamp
                              ? "Sin folio"
                              : labels.get(p.id)}
                        </small>
                      </span>
                    </button>
                  ))}
                </div>
              </aside>
              <section className="viewer">
                <div className="viewer-toolbar">
                  <span className="viewer-label">
                    {mode === "review" ? (
                      <>
                        <CheckCircle2 size={16} /> Revisión final
                      </>
                    ) : (
                      <>
                        <FileText size={16} /> Vista previa de edición
                      </>
                    )}
                  </span>
                  <div className="zoom">
                    <button
                      aria-label="Reducir zoom"
                      onClick={() => setZoom(Math.max(30, zoom - 10))}
                    >
                      <ZoomOut size={16} />
                    </button>
                    <span>{zoom}%</span>
                    <button
                      aria-label="Aumentar zoom"
                      onClick={() => setZoom(Math.min(160, zoom + 10))}
                    >
                      <ZoomIn size={16} />
                    </button>
                  </div>
                </div>
                <div className="canvas-area">
                  {mode === "review" ? (
                    reviewPdf.doc ? (
                      <PdfPage
                        key={`review-${reviewIndex}`}
                        doc={reviewPdf.doc}
                        index={reviewIndex}
                        width={(595 * zoom) / 100}
                        onReady={setReviewReady}
                      />
                    ) : (
                      <LoaderCircle className="spin" />
                    )
                  ) : sourcePdf.doc && page ? (
                    <PdfPage
                      key={page.id}
                      doc={sourcePdf.doc}
                      index={page.sourceIndex}
                      rotation={page.rotation}
                      width={(595 * zoom) / 100}
                      edit={page}
                      config={config}
                      label={labels.get(page.id)}
                    />
                  ) : (
                    <LoaderCircle className="spin" />
                  )}
                </div>
                <div className="viewer-footer">
                  <button
                    aria-label="Página anterior"
                    disabled={
                      mode === "review" ? reviewIndex === 0 : pageIndex === 0
                    }
                    onClick={() =>
                      mode === "review"
                        ? setReviewIndex(reviewIndex - 1)
                        : setSelected(config.pages[pageIndex - 1].id)
                    }
                  >
                    <ChevronLeft size={17} />
                  </button>
                  <span>
                    {mode === "review"
                      ? `Página ${reviewIndex + 1} de ${included}`
                      : `Posición ${pageIndex + 1} de ${config.pages.length}`}
                  </span>
                  <button
                    aria-label="Página siguiente"
                    disabled={
                      mode === "review"
                        ? reviewIndex >= included - 1
                        : pageIndex >= config.pages.length - 1
                    }
                    onClick={() =>
                      mode === "review"
                        ? setReviewIndex(reviewIndex + 1)
                        : setSelected(config.pages[pageIndex + 1].id)
                    }
                  >
                    <ChevronRight size={17} />
                  </button>
                </div>
              </section>
              <aside className="settings-panel">
                <div className="panel-heading">
                  <h2>
                    <SlidersHorizontal size={17} /> Configuración
                  </h2>
                  <span className="small-label">FOLIOS</span>
                </div>
                {mode === "review" ? (
                  <div className="review-panel">
                    <div className="review-check">
                      <CheckCircle2 size={36} />
                    </div>
                    <h3>Listo para revisar</h3>
                    <p>
                      Este es el PDF definitivo. Recorre sus páginas y descarga
                      cuando todo esté correcto.
                    </p>
                    <dl>
                      <div>
                        <dt>Páginas</dt>
                        <dd>{included}</dd>
                      </div>
                      <div>
                        <dt>Con folio</dt>
                        <dd>{labels.size}</dd>
                      </div>
                      <div>
                        <dt>Revisión</dt>
                        <dd>{job?.revision}</dd>
                      </div>
                    </dl>
                    <button
                      className="secondary full"
                      disabled={!!busy}
                      onClick={() => setMode("edit")}
                    >
                      Volver a editar
                    </button>
                  </div>
                ) : (
                  <fieldset disabled={!!busy} className="settings-fields">
                    <section>
                      <h3>Numeración</h3>
                      <div className="fields">
                        <label>
                          Número inicial
                          <input
                            aria-label="Número inicial"
                            type="number"
                            min="0"
                            value={config.start}
                            onChange={(e) =>
                              change({
                                ...config,
                                start: Number(e.target.value),
                              })
                            }
                          />
                        </label>
                        <label>
                          Orden
                          <select
                            value={config.direction}
                            onChange={(e) =>
                              change({
                                ...config,
                                direction: e.target.value as "asc" | "desc",
                                start: e.target.value === "desc" ? included : 1,
                              })
                            }
                          >
                            <option value="asc">Ascendente</option>
                            <option value="desc">Descendente</option>
                          </select>
                        </label>
                      </div>
                      <div className="fields">
                        <label>
                          Prefijo
                          <input
                            maxLength={40}
                            placeholder="Ej. F-"
                            value={config.prefix}
                            onChange={(e) =>
                              change({ ...config, prefix: e.target.value })
                            }
                          />
                        </label>
                        <label>
                          Dígitos mínimos
                          <input
                            type="number"
                            min="2"
                            max="12"
                            value={config.digits}
                            onChange={(e) =>
                              change({
                                ...config,
                                digits: Number(e.target.value),
                              })
                            }
                          />
                        </label>
                      </div>
                      <p className="field-hint">
                        Las páginas sin folio también consumen un número.
                      </p>
                    </section>
                    <section>
                      <h3>Ubicación del folio</h3>
                      <PositionControls
                        value={config.position}
                        onChange={(position) => change({ ...config, position })}
                      />
                    </section>
                    <section>
                      <h3>Apariencia</h3>
                      <div className="fields">
                        <label>
                          Tamaño <span>pt</span>
                          <input
                            type="number"
                            min="6"
                            max="72"
                            value={config.size}
                            onChange={(e) =>
                              change({
                                ...config,
                                size: Number(e.target.value),
                              })
                            }
                          />
                        </label>
                        <label>
                          Color
                          <input
                            type="color"
                            value={config.color}
                            onChange={(e) =>
                              change({ ...config, color: e.target.value })
                            }
                          />
                        </label>
                      </div>
                    </section>
                    {page && (
                      <section className="page-settings">
                        <h3>Página original {page.sourceIndex + 1}</h3>
                        <div className="page-buttons">
                          <button
                            type="button"
                            className="secondary"
                            onClick={() =>
                              patchPage({
                                rotation: ((page.rotation + 90) %
                                  360) as PageEdit["rotation"],
                              })
                            }
                          >
                            <RotateCw size={15} /> Girar
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label="Mover página arriba"
                            disabled={pageIndex === 0}
                            onClick={() => move(-1)}
                          >
                            <ArrowUp size={16} />
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label="Mover página abajo"
                            disabled={pageIndex === config.pages.length - 1}
                            onClick={() => move(1)}
                          >
                            <ArrowDown size={16} />
                          </button>
                        </div>
                        <label className="check-label">
                          <input
                            type="checkbox"
                            checked={page.included}
                            onChange={(e) =>
                              patchPage({ included: e.target.checked })
                            }
                          />
                          Incluir en el PDF final
                        </label>
                        <label className="check-label">
                          <input
                            type="checkbox"
                            disabled={!page.included}
                            checked={page.stamp}
                            onChange={(e) =>
                              patchPage({ stamp: e.target.checked })
                            }
                          />
                          Mostrar folio
                        </label>
                        <label className="check-label">
                          <input
                            type="checkbox"
                            checked={!!page.position}
                            onChange={(e) =>
                              patchPage({
                                position: e.target.checked
                                  ? { ...config.position }
                                  : null,
                              })
                            }
                          />
                          Ubicación propia para esta página
                        </label>
                        {page.position && (
                          <PositionControls
                            value={page.position}
                            onChange={(position) => patchPage({ position })}
                          />
                        )}
                      </section>
                    )}
                    <button
                      type="button"
                      className="text-button reset"
                      onClick={() => {
                        if (
                          job &&
                          confirm(
                            "¿Restablecer el orden y todos los ajustes de foliación?",
                          )
                        )
                          change(defaultConfig(job.pages));
                      }}
                    >
                      Restablecer edición
                    </button>
                  </fieldset>
                )}
              </aside>
            </div>
            {validation && !validation.success && (
              <div role="alert" className="alert">
                {validation.error.issues.map((i) => i.message).join(" ")}
              </div>
            )}
            <div className="bottom-bar">
              <span>
                <ShieldCheck size={17} />
                {mode === "review"
                  ? "La descarga será idéntica a esta revisión."
                  : "La revisión final confirma la ubicación exacta de los folios."}
              </span>
              <div>
                {mode === "edit" ? (
                  <button
                    className="primary"
                    disabled={!!busy || !validation?.success}
                    onClick={() => void generate()}
                  >
                    {busy ? (
                      <LoaderCircle size={18} className="spin" />
                    ) : (
                      <FileCheck2 size={18} />
                    )}{" "}
                    {busy || "Generar revisión final"}{" "}
                    <ChevronRight size={16} />
                  </button>
                ) : (
                  <button
                    className="primary"
                    disabled={!!busy || !canDownload}
                    onClick={() => void download()}
                  >
                    <Download size={18} />
                    {busy || "Descargar PDF"}
                  </button>
                )}
              </div>
            </div>
          </>
        )}
        <footer>
          <span>Folio · Documentos en orden</span>
          <span>PDF de salida · Original sin modificaciones</span>
        </footer>
      </main>
    </div>
  );
}
