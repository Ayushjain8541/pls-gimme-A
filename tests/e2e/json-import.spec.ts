import { test, expect } from "@playwright/test";
import { portablePaper } from "../fixtures/portable-paper";
test("own-chat JSON workflow provides prompts, repairs a rejected file and practises without automatic AI", async ({
  page,
  request,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const mod = await (
    await request.post("/api/modules", {
      data: { code: `JSON${Date.now()}`, title: "Own ChatGPT imports" },
    })
  ).json();
  await page.route("**/api/status", (r) =>
    r.fulfill({ json: { aiConfigured: false } }),
  );
  await page.goto(`/modules/${mod.id}`);
  await page
    .getByRole("button", { name: "Import JSON", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Copy conversion prompt", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Copied conversion prompt" }),
  ).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "JSON Schema",
  );
  const download = await request.get("/api/import-format?download=example");
  expect(download.headers()["content-disposition"]).toContain("attachment");
  expect((await download.json()).formatVersion).toBe(1);
  await page.getByLabel("Paper JSON file", { exact: true }).setInputFiles({
    name: "paper.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"formatVersion":'),
  });
  await page
    .getByRole("button", { name: "Validate JSON", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Import paper", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Copy repair prompt", exact: true })
    .click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "Invalid JSON",
  );
  await expect(page.getByLabel("Repair prompt", { exact: true })).toHaveValue(
    /ENTIRE corrected/,
  );
  const p = portablePaper();
  p.title = "Imported practice";
  Object.assign(p.questions[0], { questionPages: [2, 3], answerPages: [4] });
  await page.getByLabel("Paper JSON file", { exact: true }).setInputFiles({
    name: "paper.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(p)),
  });
  await page
    .getByRole("button", { name: "Validate JSON", exact: true })
    .click();
  await expect(
    page.getByText("Ready to import: Imported practice", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Import paper", exact: true }).click();
  await expect(page.getByText("Ready", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Start practice", exact: true }).click();
  await expect(page.getByTestId("feedback-explanation")).toHaveCount(0);
  await expect(
    page.getByText("Largest signed 8-bit integer?", { exact: true }),
  ).toBeVisible();
  await page.getByRole("radio", { name: "B 255" }).check();
  await page
    .getByRole("button", { name: "Submit answer", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Incorrect", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("feedback-explanation")).toContainText(
    "Unsigned maximum.",
  );
  await page
    .getByRole("button", { name: "Next question", exact: true })
    .click();
  await page
    .getByLabel("Your answer", { exact: true })
    .fill("Zero uses one representation.");
  await page
    .getByRole("button", { name: "Submit answer", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Compare your answer", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Assess with AI (optional)",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".reference")).toContainText(
    "AI-GENERATED, UNVERIFIED",
  );
  await expect(page.getByTestId("feedback-explanation")).toContainText(
    "extra negative",
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Compare your answer", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: ".data/qa/json-self-review.png",
    fullPage: true,
  });
  const paperId = new URL(page.url()).pathname.split("/")[2];
  await page.goto(`/papers/${paperId}/review`);
  await expect(
    page.getByText(
      "To correct this paper, import a corrected JSON file from its module.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save and prepare", exact: true }),
  ).toHaveCount(0);
});
test("JSON paste corrections invalidate the validation summary and stay usable on mobile", async ({
  page,
  request,
}) => {
  const mod = await (
    await request.post("/api/modules", {
      data: { code: `JM${Date.now()}`, title: "JSON mobile" },
    })
  ).json();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/modules/${mod.id}`);
  await page
    .getByRole("button", { name: "Import JSON", exact: true })
    .first()
    .click();
  await page
    .getByLabel("Paper JSON", { exact: true })
    .fill(JSON.stringify(portablePaper()));
  await page
    .getByRole("button", { name: "Validate JSON", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Import paper", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Paper JSON", { exact: true }).fill("{");
  await expect(
    page.getByRole("button", { name: "Import paper", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: ".data/qa/json-import-mobile.png",
    fullPage: true,
  });
});
