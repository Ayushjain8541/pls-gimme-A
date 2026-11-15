import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
function pdf(text: string) {
  const dir = mkdtempSync(`${tmpdir()}/flow-pdf-`),
    file = dir + "/paper.pdf";
  execFileSync(".venv/bin/python", [
    "-c",
    "import pymupdf,sys;d=pymupdf.open();p=d.new_page();p.insert_text((72,72),sys.argv[2]);d.save(sys.argv[1])",
    file,
    text,
  ]);
  return readFileSync(file);
}
async function moduleFolder(request: APIRequestContext) {
  const res = await request.post("/api/modules", {
    data: { code: `CS${Date.now()}`, title: "Test module" },
  });
  expect(res.ok()).toBe(true);
  return (await res.json()) as { id: string };
}
async function uploadPaper(
  page: Page,
  moduleId: string,
  question: Buffer,
  solutions = false,
) {
  await page.goto(`/modules/${moduleId}`);
  await page
    .getByRole("button", { name: "Upload papers", exact: true })
    .first()
    .click();
  await page.getByLabel("Question papers").setInputFiles({
    name: "paper.pdf",
    mimeType: "application/pdf",
    buffer: question,
  });
  if (solutions)
    await page.getByLabel("Solution files").setInputFiles({
      name: "paper-answers.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("1. A. 2(a). Zero occupies a representation."),
    });
  await page.getByRole("button", { name: "Prepare upload" }).click();
  await page.getByRole("button", { name: "Confirm and prepare" }).click();
}
test("a paper can wait for solutions and later use externally generated answers", async ({
  page,
  request,
}) => {
  const m = await moduleFolder(request);
  await uploadPaper(page, m.id, pdf("Practice without solutions"));
  await expect(
    page.getByText("Needs solutions", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Add solutions", exact: true })
    .click();
  await page
    .getByLabel("Or paste solutions")
    .fill("1. A: 127. 2(a). Zero occupies a nonnegative representation.");
  await page.getByLabel("Solution origin").selectOption("external_ai");
  await page.getByRole("button", { name: "Attach and prepare" }).click();
  await expect(page.getByText("Ready", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole("link", { name: "Start practice" }).click();
  await page.getByRole("radio", { name: "A 127" }).check();
  await page
    .getByRole("button", { name: "Submit answer", exact: true })
    .click();
  await expect(
    page.getByText("Provisional assessment", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("AI-GENERATED, UNVERIFIED", { exact: false }),
  ).toBeVisible();
});
test("flagged conversions can be repaired while raw HTML stays inert", async ({
  page,
  request,
}) => {
  const m = await moduleFolder(request);
  await uploadPaper(
    page,
    m.id,
    pdf("FLAG_REVIEW: original questions need checking"),
    true,
  );
  await expect(page.getByRole("link", { name: "Resolve issues" })).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole("link", { name: "Resolve issues" }).click();
  await page
    .getByRole("textbox", { name: "Question text", exact: true })
    .first()
    .fill(
      "Original question.\n\n<script>window.unexpectedExecution=true</script>\n<img src=x onerror=window.unexpectedExecution=true>",
    );
  await page
    .getByLabel(
      "I’ve checked the flagged items and corrected or excluded anything unresolved.",
    )
    .check();
  await page.getByRole("button", { name: "Save and prepare" }).click();
  await expect(
    page.getByText("Saved. Explanations are preparing in the background.", {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Back to module", exact: true }).click();
  await expect(page.getByText("Ready", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole("link", { name: "Start practice" }).click();
  await expect(
    page.getByText("Original question.", { exact: false }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      Object.prototype.hasOwnProperty.call(window, "unexpectedExecution"),
    ),
  ).toBe(false);
});
test("mobile library has no horizontal overflow and a usable module dialog", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "New module" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: ".data/qa/mobile.png", fullPage: true });
});

test("clearing a saved typed draft remains cleared when revisiting the question", async ({
  page,
  request,
}) => {
  const m = await moduleFolder(request);
  await uploadPaper(page, m.id, pdf("Draft persistence test"), true);
  await expect(page.getByText("Ready", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole("link", { name: "Start practice" }).click();
  await page.getByRole("button", { name: "Next question" }).click();
  await page.getByLabel("Your answer").fill("A draft to erase");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.getByLabel("Your answer").fill("");
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await page.getByRole("button", { name: "Next question" }).click();
  await expect(page.getByLabel("Your answer")).toHaveValue("");
});
