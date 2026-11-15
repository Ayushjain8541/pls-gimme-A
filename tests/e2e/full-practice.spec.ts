import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
test("module upload converts automatically then practice feedback and completion persist", async ({
  page,
}) => {
  test.setTimeout(120000);
  const dir = mkdtempSync(`${tmpdir()}/browser-pdf-`);
  const pdfs: string[] = [];
  const keys: { name: string; mimeType: string; buffer: Buffer }[] = [];
  for (let i = 0; i < 10; i++) {
    const title = i === 0 ? "2526" : `practice-${i}`;
    const file = `${dir}/${title}.pdf`;
    execFileSync(".venv/bin/python", [
      "-c",
      "import pymupdf,sys;d=pymupdf.open();p=d.new_page();p.insert_text((72,72),sys.argv[2]);d.save(sys.argv[1])",
      file,
      `Practice ${i}: largest signed 8-bit integer? A: 127 B: 255`,
    ]);
    pdfs.push(file);
    const keyFile = `${dir}/${title}-answers.pdf`;
    execFileSync(".venv/bin/python", [
      "-c",
      "import pymupdf,sys;d=pymupdf.open();p=d.new_page();p.insert_text((72,72),sys.argv[2]);d.save(sys.argv[1])",
      keyFile,
      `Practice ${i} solutions: 1. A: 127. 2(a). Zero occupies a nonnegative representation.`,
    ]);
    keys.push({
      name: `${title}-answers.pdf`,
      mimeType: "application/pdf",
      buffer: readFileSync(keyFile),
    });
  }
  await page.goto("/");
  await page.getByRole("button", { name: "New module" }).click();
  const code = "CS" + Date.now();
  await page.getByLabel("Module code").fill(code);
  await page.getByLabel("Module name").fill("Computer Organisation");
  await page
    .getByRole("button", { name: "Create module", exact: true })
    .click();
  await page
    .getByRole("main")
    .getByRole("link", { name: new RegExp(code) })
    .click();
  await page
    .getByRole("button", { name: "Upload papers", exact: true })
    .first()
    .click();
  await page.getByLabel("Question papers", { exact: true }).setInputFiles(pdfs);
  await page.getByLabel("Solution files", { exact: true }).setInputFiles(keys);
  await page.getByRole("button", { name: "Prepare upload" }).click();
  await page.getByRole("button", { name: "Confirm and prepare" }).click();
  await expect(page.getByText("Ready", { exact: true })).toHaveCount(10, {
    timeout: 90000,
  });
  await page
    .locator(".paper-row")
    .filter({ has: page.getByRole("heading", { name: "2526", exact: true }) })
    .getByRole("link", { name: "Start practice" })
    .click();
  await expect(
    page.getByText("What is the largest signed 8-bit integer?"),
  ).toBeVisible();
  await expect(page.getByTestId("feedback-explanation")).toHaveCount(0);
  await page.getByRole("radio", { name: "B 255" }).check();
  await page
    .getByRole("button", { name: "Submit answer", exact: true })
    .click();
  await expect(page.getByTestId("feedback-explanation")).toContainText(
    "unsigned maximum",
  );
  await page.getByText("Question this feedback", { exact: true }).click();
  await page
    .getByLabel("Ask about this question")
    .fill("Why is 255 not correct?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.locator(".chat-message.assistant")).toContainText(
    "unsigned maximum",
  );
  await page.screenshot({ path: ".data/qa/player.png", fullPage: true });
  await page.reload();
  await expect(page.getByText("Incorrect", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next question" }).click();
  await page
    .getByLabel("Your answer")
    .fill("Zero takes one nonnegative representation.");
  await page
    .getByRole("button", { name: "Submit answer", exact: true })
    .click();
  await expect(page.getByText("Partly correct", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await page
    .getByRole("button", { name: "Go to question 3", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Skip: requires drawing", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Paper completed" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Back to module" }).click();
  await expect(
    page.locator(".papers-table").getByText("Completed", { exact: true }),
  ).toBeVisible();
});
