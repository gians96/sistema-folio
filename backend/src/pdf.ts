import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { randomUUID } from "node:crypto";
import {
  folios,
  MM_TO_PT,
  type FolioConfig,
  type PageInfo,
  type Position,
} from "@folio/shared";

export async function inspectPdf(
  bytes: Uint8Array,
  maxPages: number,
): Promise<PageInfo[]> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes);
  } catch {
    throw new Error(
      "PDF dañado o protegido por contraseña. Usa un PDF válido sin contraseña.",
    );
  }
  if (!doc.getPageCount() || doc.getPageCount() > maxPages)
    throw new Error(`El documento debe tener entre 1 y ${maxPages} páginas.`);
  return doc.getPages().map((p, sourceIndex) => {
    const box = p.getCropBox();
    const rotation = ((p.getRotation().angle % 360) + 360) % 360;
    if (rotation % 90 !== 0)
      throw new Error("El PDF contiene una rotación no compatible.");
    return {
      id: randomUUID(),
      sourceIndex,
      width: box.width,
      height: box.height,
      rotation,
    };
  });
}

export async function appendPdf(
  base: Uint8Array,
  extra: Uint8Array,
  maxPages: number,
): Promise<{ bytes: Uint8Array; pages: PageInfo[] }> {
  const pages = await inspectPdf(extra, maxPages);
  const doc = await PDFDocument.load(base);
  const offset = doc.getPageCount();
  if (offset + pages.length > maxPages)
    throw new Error(`El trabajo no puede superar ${maxPages} páginas.`);
  const other = await PDFDocument.load(extra);
  for (const page of await doc.copyPages(other, other.getPageIndices()))
    doc.addPage(page);
  return {
    bytes: await doc.save(),
    pages: pages.map((p) => ({ ...p, sourceIndex: p.sourceIndex + offset })),
  };
}

export function placement(
  width: number,
  height: number,
  rotation: number,
  position: Position,
  textWidth: number,
  ascent: number,
  descent: number,
) {
  const viewWidth = rotation % 180 ? height : width;
  const viewHeight = rotation % 180 ? width : height;
  const mx = position.marginX * MM_TO_PT,
    my = position.marginY * MM_TO_PT;
  const x = position.corner.endsWith("right") ? viewWidth - mx - textWidth : mx;
  const y = position.corner.startsWith("top")
    ? viewHeight - my - ascent
    : my + descent;
  if (
    x < 0 ||
    y - descent < 0 ||
    x + textWidth > viewWidth ||
    y + ascent > viewHeight
  )
    throw new Error(
      "Un folio queda fuera de la página. Reduce el tamaño, el prefijo o los márgenes.",
    );
  if (rotation === 90) return { x: width - y, y: x };
  if (rotation === 180) return { x: width - x, y: height - y };
  if (rotation === 270) return { x: y, y: height - x };
  return { x, y };
}

export async function renderPdf(
  bytes: Uint8Array,
  config: FolioConfig,
): Promise<Uint8Array> {
  const source = await PDFDocument.load(bytes);
  const output = await PDFDocument.create();
  const font = await output.embedFont(StandardFonts.Helvetica);
  const labels = folios(config);
  const color = rgb(
    ...([1, 3, 5].map(
      (i) => parseInt(config.color.slice(i, i + 2), 16) / 255,
    ) as [number, number, number]),
  );
  for (const edit of config.pages.filter((p) => p.included)) {
    const [page] = await output.copyPages(source, [edit.sourceIndex]);
    const rotation =
      (((page.getRotation().angle + edit.rotation) % 360) + 360) % 360;
    page.setRotation(degrees(rotation));
    output.addPage(page);
    const label = labels.get(edit.id);
    if (label === undefined) continue;
    const crop = page.getCropBox();
    const ascent = font.heightAtSize(config.size, { descender: false });
    const descent = font.heightAtSize(config.size) - ascent;
    const pos = placement(
      crop.width,
      crop.height,
      rotation,
      edit.position ?? config.position,
      font.widthOfTextAtSize(label, config.size),
      ascent,
      descent,
    );
    page.drawText(label, {
      x: crop.x + pos.x,
      y: crop.y + pos.y,
      font,
      size: config.size,
      color,
      rotate: degrees(rotation),
    });
  }
  return output.save();
}
