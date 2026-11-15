import { test, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { documentWindows } from "../../src/features/ingestion/windows";
function pages(count: number, bytes = 1) {
  const dir = mkdtempSync(path.join(tmpdir(), "windows-")),
    imagePath = path.join(dir, "page.png");
  writeFileSync(imagePath, new Uint8Array(bytes));
  return Array.from({ length: count }, (_, i) => ({ page: i + 1, imagePath }));
}
test("ordinary exam papers are converted in one complete-document request", () => {
  const windows = documentWindows(pages(14));
  expect(windows).toHaveLength(1);
  expect(windows[0]).toMatchObject({
    completeDocument: true,
    totalPages: 14,
    firstPrimaryPage: 1,
    lastPrimaryPage: 14,
  });
  expect(windows[0].pages).toHaveLength(14);
});
test("large papers have explicit primary-page ownership and bounded overlapping context", () => {
  const windows = documentWindows(pages(25));
  expect(windows[0]).toMatchObject({
    completeDocument: false,
    firstPrimaryPage: 1,
    lastPrimaryPage: 4,
    totalPages: 25,
  });
  expect(windows[0].pages.map((p) => p.page)).toEqual([1, 2, 3, 4, 5]);
  expect(windows[1].pages.map((p) => p.page)).toEqual([4, 5, 6, 7, 8, 9]);
  expect(windows.at(-1)?.lastPrimaryPage).toBe(25);
});
test("image-heavy papers split to keep request images within the payload budget", () => {
  const windows = documentWindows(pages(4, 6 * 1024 * 1024));
  expect(windows.length).toBeGreaterThan(1);
  for (const window of windows)
    expect(window.pages.length * 6 * 1024 * 1024).toBeLessThanOrEqual(
      20 * 1024 * 1024,
    );
});
