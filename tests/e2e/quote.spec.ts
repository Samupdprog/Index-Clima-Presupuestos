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
    await expect(dialog.locator("tbody tr")).toHaveCount(5);
    await page.screenshot({ path: "test-results/adjustment-preview.png", fullPage: true });
    await dialog.getByRole("button", { name: "Aplicar ajuste", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    const saved = await (await request.get(`/api/backend/quotes/${quote.id}`)).json();
    expect(saved.calculation.cost).toBe("5749.38"); expect(saved.calculation.saleWithoutTax).toBe("6049.38"); expect(saved.priceAdjustments).toHaveLength(1);
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
