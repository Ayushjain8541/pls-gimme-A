import { test, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { openDb } from "../../src/server/db/client";
import { createModule } from "../../src/features/library/service";
import { saveDocument } from "../../src/features/documents/service";
import { extractPdf } from "../../src/features/ingestion/pdf";
test("real PDF extraction preserves page references and rejects corrupt/encrypted files", async () => {
  const dir = mkdtempSync(`${tmpdir()}/pdf-`);
  execFileSync(".venv/bin/python", [
    "-c",
    `import pymupdf\nd=pymupdf.open()\np=d.new_page()\np.insert_text((72,72),'1. What is 2 + 2? A: 4 B: 5')\nd.save('${dir}/q.pdf')`,
  ]);
  const db = openDb(dir + "/db");
  const m = createModule(db, { code: "CS2100", title: "Test" });
  const q = await saveDocument(db, m.id, {
    name: "q.pdf",
    role: "question",
    mime: "application/pdf",
    stream: new Blob([readFileSync(dir + "/q.pdf")]).stream(),
  });
  const result = await extractPdf(db, q.id);
  expect(result.pages).toHaveLength(1);
  expect(result.pages[0].text).toContain("2 + 2");
  expect(result.pages[0].page).toBe(1);
  expect(result.pages[0].pageAssetId).toBeTruthy();
  const bad = await saveDocument(db, m.id, {
    name: "bad.pdf",
    role: "question",
    mime: "application/pdf",
    stream: new Blob(["%PDF-1.4 broken"]).stream(),
  });
  await expect(extractPdf(db, bad.id)).rejects.toThrow();
  db.close();
});
