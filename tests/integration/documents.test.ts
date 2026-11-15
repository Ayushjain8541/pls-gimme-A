import { test, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { openDb } from "../../src/server/db/client";
import { createModule } from "../../src/features/library/service";
import {
  saveDocument,
  createPaper,
  readSource,
} from "../../src/features/documents/service";
function setup() {
  const db = openDb(mkdtempSync(`${tmpdir()}/docs-`) + "/app.sqlite");
  return {
    db,
    module: createModule(db, {
      code: "CS2100",
      title: "Computer Organisation",
    }),
  };
}
const stream = (s: string) => new Blob([s]).stream();
test("uploads belong to the selected module and papers without keys wait for solutions", async () => {
  const { db, module } = setup();
  const q = await saveDocument(db, module.id, {
    name: "../../paper.pdf",
    role: "question",
    mime: "application/pdf",
    stream: stream("%PDF-1.4\nexample"),
  });
  const p = createPaper(db, module.id, {
    title: "2526",
    questionDocumentId: q.id,
  });
  expect(p.state).toBe("needs_solutions");
  expect(p.moduleId).toBe(module.id);
  expect(() => readSource(db, q.id, "question")).not.toThrow();
  const other = createModule(db, {
    code: "CS2103",
    title: "Software Engineering",
  });
  expect(() =>
    createPaper(db, other.id, { title: "wrong", questionDocumentId: q.id }),
  ).toThrow();
  db.close();
});
test("rejects disguised PDFs and prevents solution files through question source controls", async () => {
  const { db, module } = setup();
  await expect(
    saveDocument(db, module.id, {
      name: "fake.pdf",
      role: "question",
      mime: "application/pdf",
      stream: stream("not a PDF"),
    }),
  ).rejects.toThrow();
  const a = await saveDocument(db, module.id, {
    name: "key.md",
    role: "solution",
    mime: "text/markdown",
    stream: stream("1. A"),
  });
  expect(() => readSource(db, a.id, "question")).toThrow();
  expect(readFileSync(readSource(db, a.id, "review").path, "utf8")).toBe(
    "1. A",
  );
  db.close();
});

test("oversized text is rejected without leaving a document row", async () => {
  const { db, module } = setup();
  const bytes = new Uint8Array(1024 * 1024 + 1).fill(65);
  await expect(
    saveDocument(db, module.id, {
      name: "large.md",
      mime: "text/markdown",
      role: "solution",
      stream: new Blob([bytes]).stream(),
    }),
  ).rejects.toThrow();
  expect(
    (db.prepare("SELECT count(*) AS n FROM documents").get() as { n: number })
      .n,
  ).toBe(0);
  db.close();
});
