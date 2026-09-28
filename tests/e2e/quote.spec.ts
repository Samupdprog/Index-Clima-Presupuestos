import { expect, test } from "@playwright/test";

test("five-machine import, collapsible editor and backend adjustment", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", async (response) => { if (response.url().includes("/api/backend/") && !response.ok()) errors.push(`HTTP ${response.status()} ${response.url()}: ${await response.text()}`); });
  const created = await request.post("/api/backend/quotes", { data: { title: `TEST E2E ${Date.now()}` } }); expect(created.ok()).toBeTruthy();
  const quote = await created.json();
  try {
    const imported = await request.post(`/api/backend/quotes/${quote.id}/commands`, { data: { type: "importQuoteLines", expectedRevision: quote.revision, lines: ["1283.94", "1260", "1159.20", "1283.94", "762.30"].map((directUnitCost, i) => ({ description: `TEST Máquina ${i + 1}`, quantity: "1", directUnitCost, type: "material", igicRate: "7" })) } });
    expect(imported.ok(), await imported.text()).toBeTruthy();
    await page.goto(`/presupuestos/${quote.id}`);
    await expect(page.getByRole("heading", { name: quote.title })).toBeVisible();
    await expect(page.getByText("5749,38", { exact: false }).or(page.getByText("5.749,38", { exact: false })).first()).toBeVisible();
    await page.getByRole("button", { name: "Editar", exact: true }).first().click();
    const dialog = page.getByRole("dialog");
    const section = dialog.getByRole("button", { name: "Proveedor y coste", exact: true });
    await expect(section).toHaveAttribute("aria-expanded", "true"); await section.click(); await expect(section).toHaveAttribute("aria-expanded", "false");
    await section.click(); await expect(section).toHaveAttribute("aria-expanded", "true");
    await dialog.getByRole("button", { name: "Guardar cambios", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await page.getByRole("button", { name: "Precio final", exact: true }).first().click();
    await page.getByRole("button", { name: "Quiero ajustar el precio", exact: true }).click();
    await dialog.getByLabel("Valor", { exact: true }).fill("300");
    await expect(dialog.getByRole("button", { name: "Aplicar ajuste", exact: true })).toBeEnabled();
    await expect(dialog.locator(".adjustment-line")).toHaveCount(5);
    await expect(dialog.getByText("ANTES · Precio actual")).toBeVisible();
    await expect(dialog.getByText("DESPUÉS · Nuevo precio")).toBeVisible();
    await page.screenshot({ path: "test-results/adjustment-preview.png", fullPage: true });
    await dialog.getByRole("button", { name: "Aplicar ajuste", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    const saved = await (await request.get(`/api/backend/quotes/${quote.id}`)).json();
    expect(saved.calculation.cost).toBe("5749.38"); expect(saved.calculation.saleWithoutTax).toBe("6049.38"); expect(saved.priceAdjustments).toHaveLength(1);
    await page.getByRole("button", { name: "Quiero ajustar el precio", exact: true }).click();
    await expect(dialog.getByText(/Presupuesto completo · \+300/)).toBeVisible();
    await expect(dialog.getByText("amount", { exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    const saved = await (await request.get(`/api/backend/quotes/${quote.id}`)).json();
    await request.post(`/api/backend/quotes/${quote.id}/commands`, { data: { type: "archiveQuote", expectedRevision: saved.revision } });
  }
});

test("settings and reset guard are usable without exposing credentials", async ({ page, request }) => {
  await page.goto("/configuracion");
  await expect(page.getByRole("heading", { name: "Configuración", exact: true })).toBeVisible();
  const denied = await request.post("/api/backend/settings/data-reset", { data: { confirmed: false, confirmation: "WRONG" } });
  expect([400, 403]).toContain(denied.status());
  const unauthorized = await request.get("http://localhost:4400/quotes"); expect(unauthorized.status()).toBe(401);
  const crossOrigin = await request.post("/api/backend/quotes", { headers: { origin: "https://evil.example.test" }, data: { title: "never-created" } });
  expect(crossOrigin.status()).toBe(403);
});

test("quote text blocks can be added, edited, dragged by their handle, reloaded and removed", async ({ page, request }) => {
  const created = await request.post("/api/backend/quotes", { data: { title: `TEST TEXTS ${Date.now()}` } });
  expect(created.ok()).toBeTruthy();
  const quote = await created.json();
  try {
    const imported = await request.post(`/api/backend/quotes/${quote.id}/commands`, { data: { type: "importQuoteLines", expectedRevision: quote.revision, lines: [{ description: "Material de prueba", quantity: "2", directUnitCost: "319.2", supplierUnitPrice: "420", type: "material", igicRate: "7" }] } });
    expect(imported.ok(), await imported.text()).toBeTruthy();
    await page.goto(`/presupuestos/${quote.id}`);
    await page.getByRole("button", { name: "Editar", exact: true }).first().click();
    const advanced = page.getByRole("dialog");
    await expect(advanced.getByLabel("Cantidad")).toHaveValue("2");
    await expect(advanced.getByLabel("PVP proveedor / ud")).toHaveValue("420");
    await expect(advanced.getByLabel("Coste neto / ud")).toHaveValue("319,2");
    await advanced.getByRole("button", { name: "Guardar cambios" }).click();
    const afterRoundTrip = await (await request.get(`/api/backend/quotes/${quote.id}`)).json();
    expect(afterRoundTrip.lines[0].supplierUnitPrice).toBe("420.000000");
    expect(afterRoundTrip.lines[0].directUnitCost).toBe("319.200000");
    const add = page.getByRole("button", { name: "Añadir texto", exact: true });
    await add.click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel("Título").fill("Trabajos incluidos");
    await dialog.getByLabel("Contenido").fill("Instalación y puesta en marcha.");
    await dialog.getByRole("button", { name: "Añadir texto", exact: true }).click();
    await add.click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("Título").fill("Condiciones");
    await dialog.getByLabel("Contenido").fill("Validez 30 días.");
    await dialog.getByRole("button", { name: "Añadir texto", exact: true }).click();
    const blocks = page.locator(".text-block");
    await expect(blocks).toHaveCount(2);
    await blocks.nth(0).getByRole("button", { name: "Acciones del texto" }).click();
    await page.getByRole("menuitem", { name: "Editar" }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("Contenido").fill("Instalación comprobada.");
    await dialog.getByRole("button", { name: "Guardar texto" }).click();
    await expect(blocks.nth(0)).toContainText("Instalación comprobada.");
    const handle = blocks.nth(1).getByRole("button", { name: "Reordenar Condiciones" });
    await handle.hover();
    await page.mouse.down();
    const source = await handle.boundingBox();
    const target = await blocks.nth(0).boundingBox();
    expect(source && target).toBeTruthy();
    await page.mouse.move(source!.x + source!.width / 2, target!.y - 15, { steps: 20 });
    await page.mouse.up();
    await expect(blocks.nth(0)).toContainText("Condiciones");
    await page.reload();
    await expect(page.locator(".text-block").nth(0)).toContainText("Condiciones");
    await expect(page.locator(".text-block").nth(1)).toContainText("Instalación comprobada.");
    await page.locator(".text-block").nth(1).getByRole("button", { name: "Acciones del texto" }).click();
    await page.getByRole("menuitem", { name: "Eliminar" }).click();
    await expect(page.locator(".text-block")).toHaveCount(1);
  } finally {
    const saved = await (await request.get(`/api/backend/quotes/${quote.id}`)).json();
    await request.post(`/api/backend/quotes/${quote.id}/commands`, { data: { type: "archiveQuote", expectedRevision: saved.revision } });
  }
});
