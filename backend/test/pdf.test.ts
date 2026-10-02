import { describe, expect, it } from "vitest";
import { PDFDocument, degrees, StandardFonts } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { configSchema, defaultConfig, folios, MM_TO_PT } from "@folio/shared";
import { inspectPdf, placement, renderPdf } from "../src/pdf.js";

async function fixture() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const rotation of [0, 90, 180, 270]) {
    const page = doc.addPage([420, 620]);
    page.setCropBox(20, 30, 380, 560);
    page.setRotation(degrees(rotation));
    page.drawText(`ORIGINAL ${rotation}`, { x: 60, y: 200, size: 20, font });
  }
  return doc.save();
}
describe("foliación y páginas", () => {
  it("numera del 01 al 09 y continúa con 10, incluso en trabajos anteriores", async () => {
    const config = defaultConfig(await inspectPdf(await fixture(), 500));
    expect(config.digits).toBe(2);
    config.start = 8;
    expect([...folios(config).values()]).toEqual(["08", "09", "10", "11"]);
    config.digits = 1;
    expect([...folios(config).values()]).toEqual(["08", "09", "10", "11"]);
  });
  it("reordena, excluye y consume número en páginas conservadas sin folio", async () => {
    const bytes = await fixture();
    const config = defaultConfig(await inspectPdf(bytes, 500));
    config.pages = [
      config.pages[2],
      config.pages[0],
      config.pages[3],
      config.pages[1],
    ];
    config.pages[1].stamp = false;
    config.pages[2].included = false;
    config.start = 8;
    config.prefix = "F-";
    config.digits = 3;
    expect([...folios(config).values()]).toEqual(["F-008", "F-010"]);
    config.direction = "desc";
    expect([...folios(config).values()]).toEqual(["F-008", "F-006"]);
    const result = await PDFDocument.load(await renderPdf(bytes, config));
    expect(result.getPageCount()).toBe(3);
    expect(result.getPages().map((p) => p.getRotation().angle)).toEqual([
      180, 0, 90,
    ]);
    expect(result.getPage(0).getCropBox()).toEqual({
      x: 20,
      y: 30,
      width: 380,
      height: 560,
    });
  });
  it("rechaza secuencias negativas, duplicados y exclusión de todas las páginas", async () => {
    const config = defaultConfig(await inspectPdf(await fixture(), 500));
    config.direction = "desc";
    config.start = 1;
    expect(configSchema.safeParse(config).success).toBe(false);
    config.start = 4;
    expect(configSchema.safeParse(config).success).toBe(true);
    config.pages[1] = config.pages[0];
    expect(configSchema.safeParse(config).success).toBe(false);
    config.pages.forEach((p) => (p.included = false));
    expect(configSchema.safeParse(config).success).toBe(false);
  });
  it("valida daños, límite de páginas y folios fuera de los bordes", async () => {
    await expect(inspectPdf(new Uint8Array([1, 2]), 500)).rejects.toThrow(
      "dañado",
    );
    await expect(inspectPdf(await fixture(), 2)).rejects.toThrow("entre 1 y 2");
    expect(() =>
      placement(
        30,
        30,
        0,
        { corner: "top-right", marginX: 10, marginY: 10 },
        100,
        12,
        3,
      ),
    ).toThrow("fuera");
  });
  it.each(["top-left", "top-right", "bottom-left", "bottom-right"] as const)(
    "coloca texto legible en %s con todas las rotaciones y CropBox desplazado",
    async (corner) => {
      const bytes = await fixture();
      const config = defaultConfig(await inspectPdf(bytes, 500));
      config.prefix = "F-";
      config.position.corner = corner;
      config.pages.forEach((p) => (p.rotation = 90));
      const output = await renderPdf(bytes, config);
      const task = getDocument({
        data: output,
        useSystemFonts: true,
        disableFontFace: true,
      });
      const pdf = await task.promise;
      for (let i = 1; i <= 4; i++) {
        const page = await pdf.getPage(i),
          viewport = page.getViewport({ scale: 1 });
        const text = await page.getTextContent();
        const stamp = text.items.find((t) => "str" in t && t.str === `F-${String(i).padStart(2, "0")}`);
        expect(stamp).toBeTruthy();
        if (!stamp || !("transform" in stamp)) throw new Error("Missing stamp");
        const [x, y] = viewport.convertToViewportPoint(
          stamp.transform[4],
          stamp.transform[5],
        );
        const mx = 10 * MM_TO_PT;
        if (corner.endsWith("left")) expect(x).toBeCloseTo(mx, 2);
        else expect(x + stamp.width).toBeCloseTo(viewport.width - mx, 2);
        if (corner.startsWith("top")) expect(y).toBeGreaterThan(mx);
        else expect(y).toBeLessThan(viewport.height - mx);
        const origin = viewport.convertToViewportPoint(
          stamp.transform[4] + stamp.transform[0],
          stamp.transform[5] + stamp.transform[1],
        );
        expect(origin[0]).toBeGreaterThan(x);
        expect(origin[1]).toBeCloseTo(y, 2);
        expect(
          text.items.filter((t) => "str" in t && t.str.startsWith("ORIGINAL")),
        ).toHaveLength(1);
      }
      await task.destroy();
      const second = await renderPdf(bytes, config);
      const secondTask = getDocument({ data: second });
      const text = await (await secondTask.promise)
        .getPage(1)
        .then((p) => p.getTextContent());
      expect(
        text.items.filter((t) => "str" in t && t.str.startsWith("F-")),
      ).toHaveLength(1);
      await secondTask.destroy();
    },
  );
});
