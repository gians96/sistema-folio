import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type WheelEvent,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  FileCheck2,
  FilePlus2,
  FileText,
  LoaderCircle,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
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
  type JobSummary,
  type JobView,
  type Limits,
  type PageEdit,
  type Position,
  type SessionView,
  type UserView,
} from "@folio/shared";
import { api } from "./api";
import { PdfPage, usePdf } from "./PdfView";
import { Admin } from "./Admin";
import { Dashboard } from "./Dashboard";
import { EditableTitle } from "./EditableTitle";
import { Login } from "./Login";
import { confirmLeave, navigate, setUnsaved, useRoute } from "./route";
import { Avatar, Brand, Sidebar } from "./Sidebar";

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
const countIncluded = (config: FolioConfig) =>
  config.pages.filter((p) => p.included).length;
/**
 * En orden descendente, si la secuencia terminaba en 1 (inicio = páginas incluidas),
 * el número inicial acompaña los cambios de páginas para seguir terminando en 1.
 */
function followCount(prev: FolioConfig | null, next: FolioConfig): FolioConfig {
  if (
    prev &&
    prev.direction === "desc" &&
    next.direction === "desc" &&
    next.start === prev.start &&
    prev.start === countIncluded(prev)
  )
    return { ...next, start: countIncluded(next) };
  return next;
}
function storedFlag(key: string) {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
function storeFlag(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // Preferencia opcional: sin almacenamiento solo dura la sesión.
  }
}
/** Archivos que faltan añadir a un trabajo recién creado (se cargaron varios a la vez). */
const pendingFiles = new Map<string, File[]>();
const fileName = (title: string) =>
  title.replace(/[\\/:*?"<>|\x00-\x1f]+/g, "-").trim() || "documento";
function Workspace({
  jobId,
  user,
  onJobsChanged,
}: {
  jobId: string | null;
  user: UserView;
  /** Actualiza la lista del menú lateral (nombre, estado). */
  onJobsChanged: () => void;
}) {
  const [job, setJob] = useState<JobView | null>(null);
  const [config, setConfig] = useState<FolioConfig | null>(null);
  const [source, setSource] = useState<ArrayBuffer | null>(null);
  const [review, setReview] = useState<ArrayBuffer | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [mode, setMode] = useState<"edit" | "review">("edit");
  const [reviewIndex, setReviewIndex] = useState(0);
  const [reviewReady, setReviewReady] = useState(false);
  // 100 % = la página completa ajustada al área visible.
  const [zoom, setZoom] = useState(100);
  const canvasArea = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState({ width: 480, height: 640 });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [hidePages, setHidePages] = useState(() =>
    storedFlag("folio-hide-pages"),
  );
  const [hideSettings, setHideSettings] = useState(() =>
    storedFlag("folio-hide-settings"),
  );
  // Páginas que se están arrastrando (una o varias).
  const [dragPage, setDragPage] = useState<string[] | null>(null);
  // Selección múltiple (Shift = rango, Ctrl = alternar); "selected" es la página activa.
  const [picked, setPicked] = useState<string[]>([]);
  const anchor = useRef("");
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(
    null,
  );
  const [toast, setToast] = useState<{
    id: number;
    message: string;
    action?: { label: string; run: () => void };
  } | null>(null);
  const latestConfig = useRef(config);
  latestConfig.current = config;
  // Navegación con la rueda: bloqueo por gesto y "armado" al llegar al borde.
  const wheel = useRef({
    lockUntil: 0,
    armed: false,
    acc: 0,
    scrollTo: "" as "" | "top" | "bottom",
  });
  const [limits, setLimits] = useState<Limits>({
    maxBytes: 0,
    maxPages: 500,
  });
  const fileInput = useRef<HTMLInputElement>(null);
  const addInput = useRef<HTMLInputElement>(null);
  const thumbnailList = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const documentBar = useRef<HTMLDivElement>(null);
  const positioned = useRef("");
  const queued = useRef<File[]>([]);
  const sourcePdf = usePdf(source),
    reviewPdf = usePdf(review);
  useEffect(() => {
    api<Limits>("/limits")
      .then(setLimits)
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!jobId) return;
    // Los demás archivos de una carga múltiple se añaden cuando el documento esté listo.
    const files = pendingFiles.get(jobId);
    if (files) {
      pendingFiles.delete(jobId);
      queued.current = files;
    }
    let cancelled = false,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await api<JobView>(`/jobs/${jobId}`);
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
          const bytes = await api<ArrayBuffer>(`/jobs/${jobId}/source`);
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
  }, [jobId]);
  useEffect(() => {
    setUnsaved(dirty);
    return () => setUnsaved(false);
  }, [dirty]);
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
  function invalidFile(file: File) {
    if (!/\.(pdf|docx?)$/i.test(file.name))
      return `${file.name}: selecciona un archivo PDF, DOC o DOCX.`;
    if (limits.maxBytes > 0 && file.size > limits.maxBytes)
      return `${file.name} supera ${limits.maxBytes / 1024 / 1024} MB.`;
    return "";
  }
  async function upload(files: File[]) {
    const [file, ...rest] = files;
    if (!file || busy) return;
    setError("");
    const invalid = files.map(invalidFile).find(Boolean);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy("Cargando documento…");
    try {
      const form = new FormData();
      form.append("file", file);
      const result = await api<{ job: JobView }>("/jobs", {
        method: "POST",
        body: form,
      });
      if (rest.length) pendingFiles.set(result.job.id, rest);
      navigate(`/trabajo/${result.job.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  async function appendFiles(files: File[], position?: number) {
    if (!jobId || !job || !config || busy || !files.length) return;
    setError("");
    const invalid = files.map(invalidFile).find(Boolean);
    if (invalid) {
      setError(invalid);
      return;
    }
    const before = position ?? config.pages.length;
    let latest: JobView | null = null;
    let total = job.pages.length,
      at = position;
    try {
      setBusy("Guardando…");
      let revision = job.revision;
      if (dirty) revision = (await save())?.revision ?? revision;
      for (const [i, file] of files.entries()) {
        setBusy(
          files.length > 1
            ? `Añadiendo ${i + 1} de ${files.length}…`
            : "Añadiendo documento…",
        );
        const form = new FormData();
        form.append("file", file);
        latest = await api<JobView>(
          `/jobs/${jobId}/files?revision=${revision}${at === undefined ? "" : `&position=${at}`}`,
          { method: "POST", body: form },
        );
        revision = latest.revision;
        // Los siguientes archivos se colocan después de las páginas recién añadidas.
        if (at !== undefined) at += latest.pages.length - total;
        total = latest.pages.length;
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (latest?.config) {
        const adjusted = followCount(config, latest.config);
        setJob(latest);
        setConfig(adjusted);
        // Si se ajustó el número inicial, queda pendiente de guardar.
        setDirty(adjusted !== latest.config);
        setReview(null);
        setMode("edit");
        setSelected(latest.config.pages[before]?.id ?? selected);
        try {
          setSource(await api<ArrayBuffer>(`/jobs/${jobId}/source`));
        } catch (e) {
          setError((e as Error).message);
        }
      }
      setBusy("");
      if (addInput.current) addInput.current.value = "";
    }
  }
  useEffect(() => {
    if (!sourcePdf.doc || busy || !queued.current.length) return;
    const files = queued.current;
    queued.current = [];
    void appendFiles(files);
  }, [sourcePdf.doc, busy]);
  function change(next: FolioConfig) {
    setConfig(followCount(latestConfig.current, next));
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
  /** Páginas afectadas por una acción: la selección múltiple si incluye a id, si no solo id. */
  function targets(id: string) {
    if (!config || picked.length < 2 || !picked.includes(id)) return [id];
    return config.pages.filter((p) => picked.includes(p.id)).map((p) => p.id);
  }
  function moveTo(ids: string[], index: number) {
    if (!config) return;
    const set = new Set(ids);
    const moving = config.pages.filter((p) => set.has(p.id));
    const rest = config.pages.filter((p) => !set.has(p.id));
    const at =
      index - config.pages.slice(0, index).filter((p) => set.has(p.id)).length;
    rest.splice(at, 0, ...moving);
    if (rest.every((p, i) => p.id === config.pages[i].id)) return;
    change({ ...config, pages: rest });
  }
  function notify(
    message: string,
    action?: { label: string; run: () => void },
  ) {
    setToast({ id: Date.now(), message, action });
  }
  function toggleIncluded(ids: string[]) {
    if (!config) return;
    const set = new Set(ids);
    // Todas quedan igual: se toma como referencia la primera afectada.
    const include = !config.pages.find((p) => set.has(p.id))?.included;
    change({
      ...config,
      pages: config.pages.map((p) =>
        set.has(p.id) ? { ...p, included: include } : p,
      ),
    });
  }
  function deletePages(ids: string[]) {
    if (!config) return;
    const set = new Set(ids);
    const removed = config.pages
      .map((page, index) => ({ page, index }))
      .filter((item) => set.has(item.page.id));
    if (!removed.length) return;
    if (removed.length >= config.pages.length) {
      notify("El trabajo debe conservar al menos una página.");
      return;
    }
    const pages = config.pages.filter((p) => !set.has(p.id));
    change({ ...config, pages });
    setPicked([]);
    if (set.has(selected))
      setSelected(pages[Math.min(removed[0].index, pages.length - 1)].id);
    notify(
      removed.length === 1
        ? `Página ${removed[0].page.sourceIndex + 1} eliminada`
        : `${removed.length} páginas eliminadas`,
      {
        label: "Deshacer",
        run: () => {
          const current = latestConfig.current;
          if (!current) return;
          const restored = [...current.pages];
          for (const { page, index } of removed)
            if (!restored.some((p) => p.id === page.id))
              restored.splice(Math.min(index, restored.length), 0, page);
          change({ ...current, pages: restored });
          setSelected(removed[0].page.id);
          if (removed.length > 1) setPicked(removed.map((r) => r.page.id));
        },
      },
    );
  }
  function openMenu(e: { clientX: number; clientY: number }, id: string) {
    if (!picked.includes(id)) setPicked([]);
    setSelected(id);
    setMenu({ x: e.clientX, y: e.clientY, id });
  }
  function rotate(ids: string[], delta: number) {
    if (!config) return;
    const set = new Set(ids);
    change({
      ...config,
      pages: config.pages.map((p) =>
        set.has(p.id)
          ? {
              ...p,
              rotation: ((p.rotation + delta + 360) %
                360) as PageEdit["rotation"],
            }
          : p,
      ),
    });
  }
  function pick(id: string, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) {
    if (!config) return;
    if (e.shiftKey) {
      const from = config.pages.findIndex((p) => p.id === (anchor.current || selected)),
        to = config.pages.findIndex((p) => p.id === id);
      const [lo, hi] = from < 0 ? [to, to] : [Math.min(from, to), Math.max(from, to)];
      setPicked(config.pages.slice(lo, hi + 1).map((p) => p.id));
    } else if (e.ctrlKey || e.metaKey) {
      const base = picked.length ? picked : selected ? [selected] : [];
      setPicked(base.includes(id) ? base.filter((x) => x !== id) : [...base, id]);
      anchor.current = id;
    } else {
      setPicked([]);
      anchor.current = id;
    }
    setSelected(id);
  }
  async function save(): Promise<JobView | null> {
    if (!jobId || !job || !config) return null;
    const validation = configSchema.safeParse(config);
    if (!validation.success)
      throw new Error(validation.error.issues.map((i) => i.message).join(" "));
    const updated = await api<JobView>(`/jobs/${jobId}/config`, {
      method: "PUT",
      body: JSON.stringify({ revision: job.revision, config }),
    });
    setJob(updated);
    setDirty(false);
    onJobsChanged();
    return updated;
  }
  async function generate() {
    if (!jobId || !config) return;
    setBusy("Preparando revisión…");
    setError("");
    setReview(null);
    setReviewReady(false);
    try {
      const saved = await save();
      if (!saved) return;
      const result = await api<JobView>(`/jobs/${jobId}/render`, {
        method: "POST",
        body: JSON.stringify({ revision: saved.revision }),
      });
      setJob(result);
      const bytes = await api<ArrayBuffer>(
        `/jobs/${jobId}/preview?revision=${result.revision}`,
      );
      setReview(bytes);
      setReviewIndex(0);
      setMode("review");
      onJobsChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function download() {
    if (!jobId || !job || !review || dirty) return;
    setBusy("Descargando…");
    setError("");
    try {
      const bytes = await api<ArrayBuffer>(
        `/jobs/${jobId}/download?revision=${job.revision}`,
      );
      const url = URL.createObjectURL(
        new Blob([bytes], { type: "application/pdf" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `${fileName(job.title)}-foliado.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  /** Elimina el trabajo y vuelve a Mis trabajos. */
  async function remove(ask = true) {
    if (
      !jobId ||
      (ask &&
        !confirm(
          "¿Eliminar este trabajo y sus archivos? Esta acción no se puede deshacer.",
        ))
    )
      return;
    setBusy("Eliminando…");
    try {
      await api(`/jobs/${jobId}`, { method: "DELETE" });
      setUnsaved(false);
      navigate("/");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function rename(title: string) {
    if (!jobId) return;
    setError("");
    try {
      const updated = await api<JobView>(`/jobs/${jobId}`, {
        method: "PATCH",
        body: JSON.stringify({ title }),
      });
      setJob((current) => current && { ...current, title: updated.title });
      onJobsChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const page = config?.pages.find((p) => p.id === selected);
  const pageIndex = config?.pages.findIndex((p) => p.id === selected) ?? 0;
  const included = config?.pages.filter((p) => p.included).length ?? 0;
  const labels = config ? folios(config) : new Map<string, string>();
  const validation = config ? configSchema.safeParse(config) : null;
  const canDownload = !!review && !!reviewPdf.doc && reviewReady && !dirty;
  useEffect(() => {
    // Mantiene visible la miniatura seleccionada sin desplazar la ventana.
    const list = thumbnailList.current,
      item = list?.querySelector<HTMLElement>(".thumbnail.current");
    if (!list || !item) return;
    const top = item.offsetTop,
      bottom = top + item.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top - 12;
    else if (bottom > list.scrollTop + list.clientHeight)
      list.scrollTop = bottom - list.clientHeight + 12;
  }, [selected, pageIndex, reviewIndex, mode]);
  async function saveNow() {
    if (busy || !config) return;
    if (!dirty) {
      notify("No hay cambios por guardar");
      return;
    }
    setBusy("Guardando…");
    try {
      await save();
      notify("Cambios guardados");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  function step(delta: number) {
    if (!config) return;
    if (mode === "review")
      setReviewIndex(Math.min(Math.max(reviewIndex + delta, 0), included - 1));
    else {
      const next = config.pages[pageIndex + delta];
      if (next) setSelected(next.id);
    }
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveNow();
        return;
      }
      if (e.key === "Escape") {
        if (menu) setMenu(null);
        else setPicked([]);
        return;
      }
      const target = e.target as HTMLElement;
      if (
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        busy ||
        target.closest("input, select, textarea, [contenteditable]")
      )
        return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        step(e.key === "ArrowLeft" ? -1 : 1);
      }
      if (e.key === "Delete" && mode === "edit" && selected && !menu) {
        e.preventDefault();
        deletePages(targets(selected));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.action ? 6000 : 2200);
    return () => clearTimeout(timer);
  }, [toast]);
  useLayoutEffect(() => {
    // Cada hoja nueva empieza arriba, salvo que se llegue retrocediendo con la rueda.
    const el = canvasArea.current;
    const target = wheel.current.scrollTo;
    wheel.current.scrollTo = "";
    wheel.current.armed = false;
    if (el) el.scrollTop = target === "bottom" ? el.scrollHeight : 0;
  }, [selected, reviewIndex, mode]);
  useEffect(() => {
    // La rueda dentro del editor no debe arrastrar la página exterior al llegar al límite.
    const el = editorRef.current;
    if (!el) return;
    const contain = (e: globalThis.WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const box = (e.target as HTMLElement).closest<HTMLElement>(
        ".canvas-area, .thumbnail-list, .settings-fields, .review-panel",
      );
      if (!box) return;
      const atEdge =
        e.deltaY > 0
          ? box.scrollTop + box.clientHeight >= box.scrollHeight - 1
          : box.scrollTop <= 0;
      if (atEdge) e.preventDefault();
    };
    el.addEventListener("wheel", contain, { passive: false });
    return () => el.removeEventListener("wheel", contain);
  }, [!!config]);
  useEffect(() => {
    // Al abrir un documento, el área de trabajo queda ajustada a la ventana.
    if (!jobId || !config) return;
    if (positioned.current === jobId) return;
    positioned.current = jobId;
    documentBar.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [jobId, !!config]);
  function onViewerWheel(e: WheelEvent<HTMLDivElement>) {
    if (!config || e.ctrlKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    const el = e.currentTarget,
      w = wheel.current,
      now = Date.now(),
      down = e.deltaY > 0;
    const atEdge = down
      ? el.scrollTop + el.clientHeight >= el.scrollHeight - 2
      : el.scrollTop <= 1;
    if (!atEdge) {
      w.armed = false;
      w.acc = 0;
      return;
    }
    // Mientras dure el mismo gesto (inercia incluida) no se cambia otra vez.
    if (now < w.lockUntil) {
      w.lockUntil = now + 220;
      return;
    }
    const overflow = el.scrollHeight > el.clientHeight + 2;
    if (overflow && !w.armed) {
      // Recién llegó al borde: hace falta otro gesto para pasar de hoja.
      w.armed = true;
      w.lockUntil = now + 220;
      return;
    }
    w.acc += e.deltaY;
    if (Math.abs(w.acc) < 40) return;
    w.acc = 0;
    w.armed = false;
    w.lockUntil = now + 400;
    const last = mode === "review" ? included - 1 : config.pages.length - 1;
    const current = mode === "review" ? reviewIndex : pageIndex;
    if (down ? current >= last : current <= 0) return;
    w.scrollTo = down ? "top" : "bottom";
    step(down ? 1 : -1);
  }
  function dropIndexAt(list: HTMLElement, y: number) {
    const items = [...list.querySelectorAll<HTMLElement>(".thumbnail")];
    const index = items.findIndex((item) => {
      const box = item.getBoundingClientRect();
      return y < box.top + box.height / 2;
    });
    return index < 0 ? items.length : index;
  }
  const menuPage = menu && config?.pages.find((p) => p.id === menu.id);
  const shownPage =
    mode === "review"
      ? config?.pages.filter((p) => p.included)[reviewIndex]
      : page;
  const shownFolio = !shownPage
    ? ""
    : !shownPage.included
      ? "Excluida"
      : !shownPage.stamp
        ? "Sin folio"
        : (labels.get(shownPage.id) ?? "");
  useEffect(() => {
    const el = canvasArea.current;
    if (!el) return;
    // Se mide la caja exterior: no cambia cuando aparecen barras de desplazamiento.
    const measure = () => {
      const css = getComputedStyle(el);
      const width =
        el.offsetWidth -
        parseFloat(css.paddingLeft) -
        parseFloat(css.paddingRight);
      const height =
        el.offsetHeight -
        parseFloat(css.paddingTop) -
        parseFloat(css.paddingBottom);
      setArea({
        width: Math.max(120, Math.floor(width) - 4),
        height: Math.max(120, Math.floor(height) - 4),
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [!!config]);
  const hasFiles = (e: DragEvent) =>
    e.dataTransfer.types.includes("Files");
  return (
    <>
      <main>
        <div className="heading">
          <div>
            <nav className="eyebrow breadcrumb" aria-label="Ruta">
              <a href="#/">Mis trabajos</a>
              <ChevronRight size={12} aria-hidden="true" />
              <span>{jobId ? (job?.title ?? "Trabajo") : "Nuevo trabajo"}</span>
            </nav>
            <h1>Foliar documentos</h1>
            <p>Organiza tus páginas. Añade los folios. Deja todo en orden.</p>
          </div>
          <div className="privacy">
            <ShieldCheck size={19} />
            <span>
              Guardado en tu cuenta
              <br />
              <strong>Disponible hasta que lo elimines</strong>
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
          multiple
          className="sr-only"
          aria-label="Seleccionar documento"
          onChange={(e) => void upload([...(e.target.files ?? [])])}
        />
        <input
          ref={addInput}
          type="file"
          accept=".pdf,.doc,.docx"
          multiple
          className="sr-only"
          aria-label="Añadir documentos"
          onChange={(e) => void appendFiles([...(e.target.files ?? [])])}
        />
        {!jobId ? (
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
                void upload([...e.dataTransfer.files]);
              }}
            >
              <div className="upload-icon">
                <UploadCloud size={34} />
              </div>
              <h2>Todo empieza con un documento</h2>
              <p>
                Arrastra uno o varios archivos aquí o selecciónalos desde tu
                equipo. Se unirán en el orden en que los sueltes.
              </p>
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
                {limits.maxBytes > 0
                  ? `Hasta ${limits.maxBytes / 1024 / 1024} MB · `
                  : "Sin límite de tamaño · Hasta "}
                {limits.maxPages} páginas
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
              {job?.status === "failed" || (!job && error) ? (
                <FileText size={32} />
              ) : (
                <LoaderCircle className="spin" size={32} />
              )}
            </div>
            <h2>
              {!job && error
                ? "No pudimos abrir este trabajo"
                : job?.status === "failed"
                  ? "No pudimos preparar el documento"
                  : "Preparando tu documento"}
            </h2>
            <p>{job?.name}</p>
            <p>
              {!job && error
                ? "Puede que se haya eliminado o que no tengas acceso."
                : job?.status === "failed"
                  ? "Comprueba el archivo y vuelve a cargarlo en un trabajo nuevo."
                  : "Estamos leyendo las páginas. Los archivos Word se convierten a PDF."}
            </p>
            {job?.status === "failed" ? (
              <button
                className="secondary"
                disabled={!!busy}
                onClick={() => void remove(false)}
              >
                Eliminar y volver
              </button>
            ) : (
              <a className="secondary" href="#/">
                Volver a Mis trabajos
              </a>
            )}
          </section>
        ) : (
          <>
            <div className="document-bar" ref={documentBar}>
              <div className="document-name">
                <FileText size={24} />
                <div>
                  {job && (
                    <EditableTitle
                      value={job.title}
                      disabled={!!busy}
                      onSave={rename}
                    />
                  )}
                  <small title={job?.name}>
                    {config.pages.length} páginas originales · {included} en el
                    PDF final
                    {job && job.userId !== user.id && " · Trabajo de otro usuario"}
                  </small>
                </div>
              </div>
              <div className="document-actions">
                <span className="save-state">
                  {dirty ? "Cambios sin guardar" : "Edición guardada"}
                </span>
                <a className="text-button" href="#/nuevo">
                  Nuevo trabajo
                </a>
                <button
                  className="text-button add-button"
                  disabled={!!busy}
                  onClick={() => addInput.current?.click()}
                >
                  <FilePlus2 size={15} /> Añadir documento
                </button>
                <button
                  className="text-button"
                  disabled={!!busy || !dirty}
                  title="Guardar (Ctrl+S)"
                  onClick={() => void saveNow()}
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
                {mode === "edit" ? (
                  <button
                    className="primary compact"
                    title="La revisión final confirma la ubicación exacta de los folios."
                    disabled={!!busy || !validation?.success}
                    onClick={() => void generate()}
                  >
                    {busy ? (
                      <LoaderCircle size={17} className="spin" />
                    ) : (
                      <FileCheck2 size={17} />
                    )}
                    {busy || "Generar revisión final"}
                    <ChevronRight size={15} />
                  </button>
                ) : (
                  <button
                    className="primary compact"
                    title="La descarga será idéntica a esta revisión."
                    disabled={!!busy || !canDownload}
                    onClick={() => void download()}
                  >
                    <Download size={17} />
                    {busy || "Descargar PDF"}
                  </button>
                )}
              </div>
            </div>
            {validation && !validation.success && (
              <div role="alert" className="alert">
                {config.direction === "desc" &&
                config.start - included + 1 < 0 ? (
                  <>
                    <span>
                      Orden descendente con {included} páginas: empezando en{" "}
                      {config.start}, las últimas tendrían folios negativos.
                      Para terminar en 1, el número inicial debe ser {included}.
                    </span>
                    <button
                      className="alert-action"
                      onClick={() => change({ ...config, start: included })}
                    >
                      Usar {included}
                    </button>
                  </>
                ) : (
                  validation.error.issues.map((i) => i.message).join(" ")
                )}
              </div>
            )}
            {job?.kind !== "pdf" && (
              <div className="notice">
                Word convertido a PDF. Revisa la distribución y las fuentes
                antes de continuar.
              </div>
            )}
            <div
              ref={editorRef}
              className={`editor ${dropping ? "drop-files" : ""} ${hidePages ? "hide-pages" : ""} ${hideSettings ? "hide-settings" : ""}`}
              onDragOver={(e) => {
                if (!hasFiles(e) || busy) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
                setDropping(true);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node))
                  setDropping(false);
              }}
              onDrop={(e) => {
                if (!hasFiles(e)) return;
                e.preventDefault();
                setDropping(false);
                void appendFiles([...e.dataTransfer.files]);
              }}
            >
              <aside className="pages-panel">
                <div className="panel-heading">
                  <h2>Páginas</h2>
                  <span title="Shift o Ctrl + clic para seleccionar varias">
                    {mode === "review"
                      ? included
                      : picked.length > 1
                        ? `${picked.length} sel.`
                        : config.pages.length}
                  </span>
                </div>
                <div
                  className="thumbnail-list"
                  ref={thumbnailList}
                  onDragOver={(e) => {
                    const files = !dragPage && hasFiles(e);
                    if (mode !== "edit" || busy || (!dragPage && !files)) return;
                    e.preventDefault();
                    // Desplaza la lista al acercarse a los bordes mientras se arrastra.
                    const box = e.currentTarget.getBoundingClientRect(),
                      edge = Math.min(80, box.height / 4);
                    if (e.clientY < box.top + edge)
                      e.currentTarget.scrollTop -= Math.ceil(
                        (box.top + edge - e.clientY) / 3,
                      );
                    else if (e.clientY > box.bottom - edge)
                      e.currentTarget.scrollTop += Math.ceil(
                        (e.clientY - (box.bottom - edge)) / 3,
                      );
                    if (files) {
                      e.stopPropagation();
                      e.dataTransfer.dropEffect = "copy";
                      setDropping(false);
                    }
                    const index = dropIndexAt(e.currentTarget, e.clientY);
                    if (index !== dropIndex) setDropIndex(index);
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node))
                      setDropIndex(null);
                  }}
                  onDrop={(e) => {
                    const index =
                      dropIndex ?? dropIndexAt(e.currentTarget, e.clientY);
                    if (dragPage) {
                      e.preventDefault();
                      moveTo(dragPage, index);
                      setDragPage(null);
                      setDropIndex(null);
                    } else if (mode === "edit" && hasFiles(e)) {
                      e.preventDefault();
                      e.stopPropagation();
                      setDropIndex(null);
                      void appendFiles([...e.dataTransfer.files], index);
                    }
                  }}
                >
                  {(mode === "review"
                    ? config.pages.filter((p) => p.included)
                    : config.pages
                  ).map((p, i, list) => (
                    <div
                      key={p.id}
                      role="button"
                      tabIndex={busy ? -1 : 0}
                      aria-disabled={!!busy}
                      draggable={mode === "edit" && !busy}
                      title={
                        mode === "edit"
                          ? "Arrastra para reordenar · clic derecho para más opciones"
                          : undefined
                      }
                      className={`thumbnail ${mode === "review" ? (reviewIndex === i ? "current" : "") : selected === p.id ? "current" : ""} ${!p.included ? "excluded" : ""} ${picked.includes(p.id) && mode === "edit" ? "picked" : ""} ${dragPage?.includes(p.id) ? "dragged" : ""} ${dropIndex === i ? "drop-before" : ""} ${dropIndex === list.length && i === list.length - 1 ? "drop-after" : ""}`}
                      onClick={(e) => {
                        if (busy) return;
                        if (mode === "review") setReviewIndex(i);
                        else pick(p.id, e);
                      }}
                      onKeyDown={(e) => {
                        if (busy || (e.key !== "Enter" && e.key !== " "))
                          return;
                        e.preventDefault();
                        if (mode === "review") setReviewIndex(i);
                        else setSelected(p.id);
                      }}
                      onDragStart={(e) => {
                        const ids = targets(p.id);
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", ids.join(","));
                        if (ids.length > 1) {
                          // Imagen de arrastre con el número de páginas.
                          const ghost = document.createElement("div");
                          ghost.className = "drag-ghost";
                          ghost.textContent = `${ids.length} páginas`;
                          document.body.append(ghost);
                          e.dataTransfer.setDragImage(ghost, 16, 16);
                          setTimeout(() => ghost.remove());
                        } else {
                          setPicked([]);
                          anchor.current = p.id;
                        }
                        setDragPage(ids);
                        setSelected(p.id);
                      }}
                      onContextMenu={(e) => {
                        if (mode !== "edit" || busy) return;
                        e.preventDefault();
                        openMenu(e, p.id);
                      }}
                      onDragEnd={() => {
                        setDragPage(null);
                        setDropIndex(null);
                      }}
                      aria-label={`Página original ${p.sourceIndex + 1}`}
                    >
                      {mode === "edit" && (
                        <div className="thumbnail-actions">
                          <button
                            type="button"
                            tabIndex={-1}
                            disabled={!!busy}
                            aria-label={`Girar página ${p.sourceIndex + 1} a la izquierda`}
                            title="Girar a la izquierda"
                            onClick={(e) => {
                              e.stopPropagation();
                              rotate(targets(p.id), -90);
                            }}
                          >
                            <RotateCcw size={12} />
                          </button>
                          <button
                            type="button"
                            tabIndex={-1}
                            disabled={!!busy}
                            aria-label={`Girar página ${p.sourceIndex + 1} a la derecha`}
                            title="Girar a la derecha"
                            onClick={(e) => {
                              e.stopPropagation();
                              rotate(targets(p.id), 90);
                            }}
                          >
                            <RotateCw size={12} />
                          </button>
                        </div>
                      )}
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
                    </div>
                  ))}
                </div>
              </aside>
              <section className="viewer">
                <div className="viewer-toolbar">
                  <button
                    className="panel-toggle"
                    title={hidePages ? "Mostrar páginas" : "Ocultar páginas"}
                    aria-label={
                      hidePages ? "Mostrar páginas" : "Ocultar páginas"
                    }
                    aria-pressed={hidePages}
                    onClick={() => {
                      setHidePages(!hidePages);
                      storeFlag("folio-hide-pages", !hidePages);
                    }}
                  >
                    {hidePages ? (
                      <PanelLeftOpen size={16} />
                    ) : (
                      <PanelLeftClose size={16} />
                    )}
                  </button>
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
                      disabled={zoom <= 30}
                    >
                      <ZoomOut size={16} />
                    </button>
                    <button
                      className="zoom-value"
                      title="Ajustar la página a la ventana"
                      aria-label={`Zoom ${zoom} %. Ajustar la página a la ventana`}
                      onClick={() => setZoom(100)}
                    >
                      {zoom === 100 ? "Ajustada" : `${zoom}%`}
                    </button>
                    <button
                      aria-label="Aumentar zoom"
                      onClick={() => setZoom(Math.min(400, zoom + 10))}
                      disabled={zoom >= 400}
                    >
                      <ZoomIn size={16} />
                    </button>
                  </div>
                  <button
                    className="panel-toggle"
                    title={
                      hideSettings
                        ? "Mostrar configuración"
                        : "Ocultar configuración"
                    }
                    aria-label={
                      hideSettings
                        ? "Mostrar configuración"
                        : "Ocultar configuración"
                    }
                    aria-pressed={hideSettings}
                    onClick={() => {
                      setHideSettings(!hideSettings);
                      storeFlag("folio-hide-settings", !hideSettings);
                    }}
                  >
                    {hideSettings ? (
                      <PanelRightOpen size={16} />
                    ) : (
                      <PanelRightClose size={16} />
                    )}
                  </button>
                </div>
                <div
                  className="canvas-area"
                  ref={canvasArea}
                  onWheel={onViewerWheel}
                  onContextMenu={(e) => {
                    if (mode !== "edit" || busy || !page) return;
                    e.preventDefault();
                    openMenu(e, page.id);
                  }}
                >
                  {mode === "review" ? (
                    reviewPdf.doc ? (
                      <PdfPage
                        key={`review-${reviewIndex}`}
                        doc={reviewPdf.doc}
                        index={reviewIndex}
                        fit={area}
                        zoom={zoom / 100}
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
                      fit={area}
                      zoom={zoom / 100}
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
                    title="Página anterior (←)"
                    disabled={
                      mode === "review" ? reviewIndex === 0 : pageIndex === 0
                    }
                    onClick={() => step(-1)}
                  >
                    <ChevronLeft size={17} />
                  </button>
                  <span>
                    {mode === "review"
                      ? `Página ${reviewIndex + 1} de ${included}`
                      : `Posición ${pageIndex + 1} de ${config.pages.length}`}
                  </span>
                  {shownFolio && (
                    <strong
                      className={`current-folio ${shownPage?.included && shownPage.stamp ? "" : "muted"}`}
                      aria-live="polite"
                    >
                      {shownFolio}
                    </strong>
                  )}
                  <button
                    aria-label="Página siguiente"
                    title="Página siguiente (→)"
                    disabled={
                      mode === "review"
                        ? reviewIndex >= included - 1
                        : pageIndex >= config.pages.length - 1
                    }
                    onClick={() => step(1)}
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
                    {page && (
                      <section className="page-settings">
                        <h3>
                          {picked.length > 1 && picked.includes(page.id)
                            ? `${picked.length} páginas seleccionadas`
                            : `Página original ${page.sourceIndex + 1}`}
                        </h3>
                        <div className="page-buttons">
                          <button
                            type="button"
                            className="secondary"
                            title="Girar a la izquierda"
                            onClick={() => rotate(targets(page.id), -90)}
                          >
                            <RotateCcw size={15} /> Izquierda
                          </button>
                          <button
                            type="button"
                            className="secondary"
                            title="Girar a la derecha"
                            onClick={() => rotate(targets(page.id), 90)}
                          >
                            <RotateCw size={15} /> Derecha
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
                          <button
                            type="button"
                            className="icon-button danger"
                            aria-label="Eliminar página"
                            title="Eliminar página (Supr)"
                            onClick={() => deletePages(targets(page.id))}
                          >
                            <Trash2 size={16} />
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
          </>
        )}
        {menu && menuPage && (
          <div
            className="context-backdrop"
            onMouseDown={() => setMenu(null)}
            onWheel={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu(null);
            }}
          >
            <div
              className="context-menu"
              role="menu"
              aria-label={`Opciones de la página ${menuPage.sourceIndex + 1}`}
              style={{
                left: Math.min(menu.x, window.innerWidth - 230),
                top: Math.min(menu.y, window.innerHeight - 210),
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="context-title">
                {targets(menuPage.id).length > 1
                  ? `${targets(menuPage.id).length} páginas seleccionadas`
                  : `Página original ${menuPage.sourceIndex + 1}`}
              </div>
              <button
                role="menuitem"
                autoFocus
                onClick={() => {
                  rotate(targets(menuPage.id), -90);
                  setMenu(null);
                }}
              >
                <RotateCcw size={15} /> Girar a la izquierda
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  rotate(targets(menuPage.id), 90);
                  setMenu(null);
                }}
              >
                <RotateCw size={15} /> Girar a la derecha
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  toggleIncluded(targets(menuPage.id));
                  setMenu(null);
                }}
              >
                {menuPage.included ? (
                  <>
                    <EyeOff size={15} /> Excluir del PDF final
                  </>
                ) : (
                  <>
                    <Eye size={15} /> Incluir en el PDF final
                  </>
                )}
              </button>
              <hr />
              <button
                role="menuitem"
                className="danger"
                onClick={() => {
                  deletePages(targets(menuPage.id));
                  setMenu(null);
                }}
              >
                <Trash2 size={15} />
                {targets(menuPage.id).length > 1
                  ? "Eliminar páginas"
                  : "Eliminar página"}{" "}
                <kbd>Supr</kbd>
              </button>
            </div>
          </div>
        )}
        {toast && (
          <div className="toast" role="status" key={toast.id}>
            {!toast.action && <CheckCircle2 size={17} />}
            <span>{toast.message}</span>
            {toast.action && (
              <button
                onClick={() => {
                  toast.action?.run();
                  setToast(null);
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        )}
        {!jobId && (
          <footer>
            <span>Folio · Documentos en orden</span>
            <span>PDF de salida · Original sin modificaciones</span>
          </footer>
        )}
      </main>
    </>
  );
}

export default function App() {
  const [session, setSession] = useState<SessionView | null>(null);
  // La sesión caducó con la aplicación abierta: se pide entrar de nuevo sin perder la vista.
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState("");
  // Trabajos del usuario: los usan el menú lateral y Mis trabajos.
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [jobsError, setJobsError] = useState("");
  // null = lo predeterminado: menú plegado en el editor y abierto en lo demás.
  const [collapse, setCollapse] = useState<boolean | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const route = useRoute();
  useEffect(() => {
    api<SessionView>("/auth/session")
      .then(setSession)
      .catch((reason) => setError((reason as Error).message));
    const onExpired = () => setExpired(true);
    window.addEventListener("folio:unauthorized", onExpired);
    return () => window.removeEventListener("folio:unauthorized", onExpired);
  }, []);
  const loadJobs = useCallback(() => {
    api<JobSummary[]>("/jobs")
      .then((list) => {
        setJobs(list);
        setJobsError("");
      })
      .catch((reason) => setJobsError((reason as Error).message));
  }, []);
  const userId = session?.user?.id;
  useEffect(() => {
    if (userId) loadJobs();
    else setJobs(null);
  }, [userId, route, loadJobs]);
  useEffect(() => {
    setCollapse(null);
    setMenuOpen(false);
  }, [route]);
  const onLogin = useCallback((user: UserView) => {
    setSession((current) => current && { ...current, user });
    setExpired(false);
  }, []);
  async function logout() {
    if (!confirmLeave()) return;
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      // Sin conexión la cookie sigue, pero la sesión se cierra en esta ventana.
    }
    setUnsaved(false);
    setExpired(false);
    setSession((current) => current && { ...current, user: null });
  }
  if (!session)
    return (
      <div className="auth-screen">
        {error ? (
          <div role="alert" className="alert">
            {error}
          </div>
        ) : (
          <LoaderCircle className="spin" size={28} aria-label="Cargando" />
        )}
      </div>
    );
  const { user, googleClientId } = session;
  if (!user) return <Login clientId={googleClientId} onLogin={onLogin} />;
  const collapsed = collapse ?? route.view === "job";
  return (
    <div className={`shell${collapsed ? " collapsed" : ""}${menuOpen ? " open" : ""}`}>
      <Sidebar
        user={user}
        route={route}
        jobs={jobs}
        collapsed={collapsed}
        onToggle={() => setCollapse(!collapsed)}
        onClose={() => setMenuOpen(false)}
        onLogout={() => void logout()}
      />
      {menuOpen && <div className="sidebar-backdrop" onClick={() => setMenuOpen(false)} />}
      <div className="shell-main">
        <header className="mobile-bar">
          <button className="icon-only" aria-label="Abrir el menú" onClick={() => setMenuOpen(true)}>
            <Menu size={20} />
          </button>
          <Brand />
          <Avatar user={user} />
        </header>
        {route.view === "admin" && user.role === "owner" ? (
          <Admin user={user} onJobsChanged={loadJobs} />
        ) : route.view === "job" || route.view === "new" ? (
          <Workspace
            key={route.view === "job" ? route.id : "nuevo"}
            jobId={route.view === "job" ? route.id : null}
            user={user}
            onJobsChanged={loadJobs}
          />
        ) : (
          <Dashboard user={user} jobs={jobs} error={jobsError} onChanged={loadJobs} />
        )}
      </div>
      {expired && <Login overlay clientId={googleClientId} onLogin={onLogin} />}
    </div>
  );
}
