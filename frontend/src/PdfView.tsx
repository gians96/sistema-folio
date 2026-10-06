import { useEffect, useRef, useState } from "react";
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { MM_TO_PT, type FolioConfig, type PageEdit } from "@folio/shared";
GlobalWorkerOptions.workerSrc = workerUrl;

export function usePdf(bytes: ArrayBuffer | null) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setDoc(null);
    setError("");
    if (!bytes) return;
    let active = true;
    const task = getDocument({
      data: bytes.slice(0),
      // Recursos servidos en /pdfjs/ (ver vite.config.ts): sin ellos los escaneos
      // con JBIG2/CCITT o JPEG 2000 se muestran en blanco.
      wasmUrl: "/pdfjs/wasm/",
      standardFontDataUrl: "/pdfjs/standard_fonts/",
      cMapUrl: "/pdfjs/cmaps/",
      cMapPacked: true,
    });
    task.promise
      .then((d) => {
        if (active) setDoc(d);
      })
      .catch(() => {
        if (active)
          setError("No se pudo mostrar el PDF. Intenta cargarlo nuevamente.");
      });
    return () => {
      active = false;
      void task.destroy();
    };
  }, [bytes]);
  return { doc, error };
}

export function PdfPage({
  doc,
  index,
  rotation = 0,
  width = 595,
  fit,
  zoom = 1,
  edit,
  config,
  label,
  onReady,
}: {
  doc: PDFDocumentProxy;
  index: number;
  rotation?: number;
  width?: number;
  /** Área disponible: la página se ajusta completa dentro y luego se aplica zoom. */
  fit?: { width: number; height: number };
  zoom?: number;
  edit?: PageEdit;
  config?: FolioConfig;
  label?: string;
  onReady?: (ready: boolean) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [geometry, setGeometry] = useState({ width: 595, height: 842 });
  const [failed, setFailed] = useState(false);
  const [rendered, setRendered] = useState(false);
  const fitWidth = fit?.width,
    fitHeight = fit?.height;
  const sizeFor = (w: number, h: number) =>
    fitWidth && fitHeight
      ? Math.max(40, Math.floor(Math.min(fitWidth, (fitHeight * w) / h) * zoom))
      : width;
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let stopped = false;
    let rendering:
      | ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]>
      | undefined;
    setFailed(false);
    setRendered(false);
    onReady?.(false);
    doc
      .getPage(index + 1)
      .then((page) => {
        if (stopped || !canvas.current) return;
        const viewport = page.getViewport({
          scale: 1,
          rotation: (page.rotate + rotation) % 360,
        });
        setGeometry({ width: viewport.width, height: viewport.height });
        const scale = sizeFor(viewport.width, viewport.height) / viewport.width;
        const ratio = window.devicePixelRatio || 1;
        const target = canvas.current;
        target.width = Math.floor(viewport.width * scale * ratio);
        target.height = Math.floor(viewport.height * scale * ratio);
        rendering = page.render({
          canvas: target,
          viewport: page.getViewport({
            scale: scale * ratio,
            rotation: (page.rotate + rotation) % 360,
          }),
        });
        return rendering.promise;
      })
      .then(() => {
        if (!stopped) {
          setRendered(true);
          onReady?.(true);
        }
      })
      .catch((e) => {
        if (!stopped && e?.name !== "RenderingCancelledException") {
          setFailed(true);
          onReady?.(false);
        }
      });
    return () => {
      stopped = true;
      rendering?.cancel();
    };
  }, [doc, index, rotation, width, fitWidth, fitHeight, zoom, visible, onReady]);
  const shownWidth = sizeFor(geometry.width, geometry.height);
  const scale = shownWidth / geometry.width;
  const position = edit?.position ?? config?.position;
  return (
    <div
      ref={host}
      className="pdf-page"
      data-rendered={rendered}
      style={{ width: shownWidth, height: geometry.height * scale }}
    >
      <canvas ref={canvas} style={{ width: "100%", height: "100%" }} />
      {failed && (
        <div className="page-failure">No se pudo mostrar esta página.</div>
      )}
      {label !== undefined && config && position && (
        <span
          className="folio-overlay"
          style={{
            fontSize: config.size * scale,
            color: config.color,
            [position.corner.endsWith("right") ? "right" : "left"]:
              position.marginX * MM_TO_PT * scale,
            [position.corner.startsWith("top") ? "top" : "bottom"]:
              position.marginY * MM_TO_PT * scale,
          }}
        >
          {label}
        </span>
      )}
    </div>
  );
}
