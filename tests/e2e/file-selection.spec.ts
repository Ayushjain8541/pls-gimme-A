import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
function files() {
  const dir = mkdtempSync(path.join(tmpdir(), "selection-"));
  for (const name of ["one.pdf", "two.pdf", "three.pdf"])
    writeFileSync(path.join(dir, name), `%PDF-1.4\nSelection fixture ${name}`);
  return ["one.pdf", "two.pdf", "three.pdf"].map((n) => path.join(dir, n));
}
async function openUpload(page: Page, request: APIRequestContext) {
  const res = await request.post("/api/modules", {
    data: { code: `UP${Date.now()}`, title: "File selection" },
  });
  expect(res.ok()).toBe(true);
  const { id } = await res.json();
  await page.goto(`/modules/${id}`);
  await page
    .getByRole("button", { name: "Upload papers", exact: true })
    .first()
    .click();
}
test("choosing additional papers preserves earlier selections in the actual upload", async ({
  page,
  request,
}) => {
  const selected = files();
  await openUpload(page, request);
  await page
    .getByLabel("Question papers", { exact: true })
    .setInputFiles(selected.slice(0, 2));
  await page
    .getByLabel("Question papers", { exact: true })
    .setInputFiles(selected[2]);
  await page.getByRole("button", { name: "Prepare upload" }).click();
  await expect(page.getByLabel("Paper title", { exact: true })).toHaveCount(3);
  await expect(
    page.getByLabel("Paper title", { exact: true }).nth(0),
  ).toHaveValue("one");
  await expect(
    page.getByLabel("Paper title", { exact: true }).nth(2),
  ).toHaveValue("three");
});

test("selected filenames stay visible, duplicates are skipped, and removed files can be re-added", async ({
  page,
  request,
}) => {
  const selected = files();
  await openUpload(page, request);
  const picker = page.getByLabel("Question papers", { exact: true });
  await picker.setInputFiles(selected.slice(0, 2));
  await picker.setInputFiles(selected[2]);
  const list = page.getByRole("list", {
    name: "Selected question papers",
    exact: true,
  });
  await expect(list.getByRole("listitem")).toHaveCount(3);
  await picker.setInputFiles(selected[0]);
  await expect(list.getByRole("listitem")).toHaveCount(3);
  await list
    .getByRole("button", { name: "Remove two.pdf", exact: true })
    .click();
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await picker.setInputFiles(selected[1]);
  await expect(list.getByRole("listitem")).toHaveCount(3);
  await expect(
    list.getByRole("link", { name: "Preview one.pdf", exact: true }),
  ).toHaveAttribute("href", /^blob:/);
});

test("dropping papers appends them and solution previews display text safely", async ({
  page,
  request,
}) => {
  const selected = files();
  await openUpload(page, request);
  await page
    .getByLabel("Question papers", { exact: true })
    .setInputFiles(selected[0]);
  const dropped = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(
      new File(["%PDF-1.4\ndropped"], "dropped.pdf", {
        type: "application/pdf",
      }),
    );
    data.items.add(new File(["bad"], "bad.png", { type: "image/png" }));
    return data;
  });
  const papers = page.getByRole("group", {
    name: "Paper drop zone",
    exact: true,
  });
  await papers.dispatchEvent("dragenter", { dataTransfer: dropped });
  await expect(papers).toHaveClass(/drag-over/);
  await papers.dispatchEvent("drop", { dataTransfer: dropped });
  const list = page.getByRole("list", {
    name: "Selected question papers",
    exact: true,
  });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(
    list.getByRole("link", { name: "Preview one.pdf", exact: true }),
  ).toBeVisible();
  await expect(
    list.getByRole("link", { name: "Preview dropped.pdf", exact: true }),
  ).toBeVisible();
  await expect(papers.getByRole("alert")).toContainText("bad.png");
  const solutionDrop = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(
      new File(
        [
          "Reference solution\n<script>window.filePreviewExecuted=true</script>",
        ],
        "answers.md",
        { type: "text/html" },
      ),
    );
    return data;
  });
  const solutionZone = page.getByRole("group", {
    name: "Solution drop zone",
    exact: true,
  });
  await solutionZone.dispatchEvent("drop", { dataTransfer: solutionDrop });
  const popup = page.waitForEvent("popup");
  await page
    .getByRole("link", { name: "Preview answers.md", exact: true })
    .click();
  const preview = await popup;
  await expect(preview.locator("body")).toContainText("Reference solution");
  expect(
    await preview.evaluate(() =>
      Object.prototype.hasOwnProperty.call(window, "filePreviewExecuted"),
    ),
  ).toBe(false);
  await preview.close();
  await dropped.dispose();
  await solutionDrop.dispose();
});
