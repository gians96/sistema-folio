import { test, expect } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
test("cargar, editar, revisar y descargar un PDF", async ({ page }) => {
  const doc = await PDFDocument.create(),
    font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 3; i++) {
    const p = doc.addPage([595, 842]);
    p.drawText(`DOCUMENTO DE PRUEBA - ${i}`, { x: 70, y: 700, size: 20, font });
  }
  await page.goto("/");
  await page.screenshot({ path: "test-results/inicio.png", fullPage: true });
  await page
    .getByLabel("Seleccionar documento", { exact: true })
    .setInputFiles({
      name: "documento.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(await doc.save()),
    });
  await expect(
    page.getByText("3 páginas originales · 3 en el PDF final"),
  ).toBeVisible();
  await expect(page.getByLabel("Dígitos mínimos")).toHaveValue("2");
  await expect(
    page.getByRole("button", { name: "Página original 1", exact: true }).getByText("01"),
  ).toBeVisible();
  await expect(page.locator(".canvas-area .pdf-page")).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await page.getByLabel("Número inicial", { exact: true }).fill("10");
  await page.getByLabel("Prefijo", { exact: true }).fill("F-");
  await page.getByLabel("Mostrar folio", { exact: true }).uncheck();
  await page
    .getByRole("button", { name: "Página original 2", exact: true })
    .click();
  await page.getByLabel("Ubicación propia para esta página").check();
  await page
    .getByRole("button", { name: "Inferior izquierda", exact: true })
    .last()
    .click();
  await page.getByRole("button", { name: "Girar", exact: true }).click();
  await expect(page.locator(".canvas-area .pdf-page")).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await page.screenshot({ path: "test-results/editor.png", fullPage: true });
  await page.getByRole("button", { name: "Generar revisión final" }).click();
  await expect(page.getByText("Listo para revisar")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Descargar PDF" }),
  ).toBeEnabled();
  await page.screenshot({ path: "test-results/revision.png", fullPage: true });
  await page
    .getByRole("button", { name: "Página original 2", exact: true })
    .click();
  await expect(page.locator(".canvas-area .pdf-page")).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await page.screenshot({
    path: "test-results/revision-girada.png",
    fullPage: true,
  });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Descargar PDF" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("documento-foliado.pdf");
  await page.getByRole("button", { name: "Volver a editar" }).click();
  await page.getByLabel("Número inicial", { exact: true }).fill("20");
  await expect(page.getByRole("button", { name: "Descargar PDF" })).toHaveCount(
    0,
  );
  await expect(page.getByText("Cambios sin guardar")).toBeVisible();
});
