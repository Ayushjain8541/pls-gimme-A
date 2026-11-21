import { test, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { openDb } from "../../src/server/db/client";
import { createModule } from "../../src/features/library/service";
import { saveDocument } from "../../src/features/documents/service";
import { handleRequest } from "../../src/server/router";
const req = (moduleId: string, documentId: string) =>
  new Request(`http://127.0.0.1/api/modules/${moduleId}/source-markdown`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ documentId }),
  });
test("source Markdown retains full page text and reports blank pages without jobs or papers", async () => {
  const dir = mkdtempSync(`${tmpdir()}/source-md-`),
    db = openDb(dir + "/db"),
    mod = createModule(db, { code: "TRANSCRIPT", title: "Source fidelity" }),
    pdf = dir + "/source.pdf";
  execFileSync(".venv/bin/python", [
    "-c",
    "import pymupdf,sys;d=pymupdf.open();p=d.new_page();p.insert_text((72,72),'Consider this machine exactly as described. Do not omit this condition.\\nEach transfer takes seven cycles, including the restart cycle.\\n(a) State the transfer time.');d.new_page();d.save(sys.argv[1])",
    pdf,
  ]);
  const document = await saveDocument(db, mod.id, {
    name: "questions.pdf",
    role: "question",
    mime: "application/pdf",
    stream: new Blob([readFileSync(pdf)]).stream(),
  });
  const response = await handleRequest(req(mod.id, document.id), db);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/markdown");
  expect(response.headers.get("content-disposition")).toContain(
    "questions-source.md",
  );
  const md = await response.text();
  expect(md).toContain(
    "Consider this machine exactly as described. Do not omit this condition.",
  );
  expect(md).toContain(
    "Each transfer takes seven cycles, including the restart cycle.",
  );
  expect(md).toContain("PDF page 1");
  expect(md).toContain("PDF page 2");
  expect(md).toContain("No embedded text");
  expect(md).toContain("SHA-256");
  const again = await handleRequest(req(mod.id, document.id), db);
  expect(await again.text()).toBe(md);
  expect(db.prepare("SELECT COUNT(*) n FROM jobs").get()).toEqual({ n: 0 });
  expect(db.prepare("SELECT COUNT(*) n FROM papers").get()).toEqual({ n: 0 });
  const other = createModule(db, { code: "OTHER", title: "Other" });
  expect((await handleRequest(req(other.id, document.id), db)).status).toBe(
    404,
  );
  db.close();
});
