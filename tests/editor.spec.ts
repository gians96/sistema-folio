import { test, expect } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
// Botón de Google falso: el servidor de pruebas acepta la credencial "sub|correo".
const fakeGoogle = `window.google = { accounts: { id: {
  initialize(options) { window.__folioGoogle = options.callback; },
  renderButton(parent) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Acceder con Google";
    button.onclick = () => window.__folioGoogle({ credential: "e2e-owner|owner@gmail.com" });
    parent.append(button);
  },
} } };`;
test("entrar, cargar, editar, revisar, descargar y retomar un trabajo guardado", async ({ page }) => {
  const doc = await PDFDocument.create(),
    font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 3; i++) {
    const p = doc.addPage([595, 842]);
    p.drawText(`DOCUMENTO DE PRUEBA - ${i}`, { x: 70, y: 700, size: 20, font });
  }
  await page.route("https://accounts.google.com/gsi/client", (route) =>
    route.fulfill({ contentType: "text/javascript", body: fakeGoogle }),
  );
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Acceso" })).toBeVisible();
  await page.getByRole("button", { name: "Acceder con Google" }).click();
  await expect(page.getByRole("heading", { name: "Tus documentos guardados" })).toBeVisible();
  await expect(page.getByText("Aún no tienes trabajos")).toBeVisible();
  await page.getByRole("link", { name: "Nuevo trabajo" }).click();
  await expect(page.getByRole("heading", { name: "Foliar documentos" })).toBeVisible();
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
    .first()
    .click();
  await page.getByRole("button", { name: "Derecha", exact: true }).click();
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
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.getByText("Edición guardada")).toBeVisible();
  // Renombrar el trabajo y retomarlo desde Mis trabajos.
  await page.getByTitle("Cambiar el nombre").click();
  await page.getByLabel("Nombre del trabajo").fill("CAS 003");
  await page.getByLabel("Nombre del trabajo").press("Enter");
  await expect(page.getByRole("button", { name: "CAS 003" })).toBeVisible();
  await page.getByRole("link", { name: "Mis trabajos", exact: true }).click();
  const card = page.locator(".job-card", { hasText: "CAS 003" });
  await expect(card.getByText("3 páginas · 3 en el PDF")).toBeVisible();
  await page.screenshot({ path: "test-results/mis-trabajos.png", fullPage: true });
  await card.getByRole("link", { name: "Abrir" }).click();
  await expect(page.getByLabel("Número inicial", { exact: true })).toHaveValue("20");
  await expect(page.getByLabel("Prefijo", { exact: true })).toHaveValue("F-");
  await page.getByRole("link", { name: "Administración" }).click();
  await expect(
    page.getByRole("row", { name: /owner@gmail\.com/ }).getByText("Propietario"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page.getByRole("heading", { name: "Acceso" })).toBeVisible();
});
