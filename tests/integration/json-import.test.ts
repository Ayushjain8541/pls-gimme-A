import { test, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { openDb } from "../../src/server/db/client";
import { createModule } from "../../src/features/library/service";
import { saveDocument } from "../../src/features/documents/service";
import { handleRequest } from "../../src/server/router";
import { portablePaper } from "../fixtures/portable-paper";
const setup = () => {
  const db = openDb(mkdtempSync(`${tmpdir()}/json-import-`) + "/db");
  const mod = createModule(db, {
    code: "CS2100",
    title: "Computer organisation",
  });
  return { db, mod };
};
const request = (url: string, input: unknown) =>
  new Request("http://127.0.0.1/api" + url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
test("JSON validation and atomic import need no worker, deduplicate and keep answers hidden before submission", async () => {
  const { db, mod } = setup();
  const input = { text: JSON.stringify(portablePaper()) };
  const preview = await handleRequest(
    request(`/modules/${mod.id}/json-import/validate`, input),
    db,
  );
  expect(preview.status).toBe(200);
  expect((await preview.json()).ok).toBe(true);
  expect(db.prepare("SELECT COUNT(*) n FROM papers").get()).toEqual({ n: 0 });
  const res = await handleRequest(
    request(`/modules/${mod.id}/json-import/confirm`, input),
    db,
  );
  expect(res.status).toBe(201);
  const paper = await res.json();
  expect(paper.state).toBe("ready");
  const repeated = await handleRequest(
    request(`/modules/${mod.id}/json-import/confirm`, input),
    db,
  );
  expect((await repeated.json()).id).toBe(paper.id);
  expect(db.prepare("SELECT COUNT(*) n FROM papers").get()).toEqual({ n: 1 });
  expect(db.prepare("SELECT COUNT(*) n FROM jobs").get()).toEqual({ n: 0 });
  const s = await (
    await handleRequest(request(`/papers/${paper.id}/sessions`, {}), db)
  ).json();
  const content = JSON.stringify(s);
  expect(content).not.toContain("correctOptionIds");
  expect(content).not.toContain("Unsigned maximum");
  const original = await handleRequest(
    new Request(
      `http://127.0.0.1/api/documents/${paper.questionDocumentId}/source?mode=question`,
    ),
    db,
  );
  expect(original.status).toBe(404);
  db.close();
});
test("bad JSON yields repair instructions and never creates a partial paper or job", async () => {
  const { db, mod } = setup();
  const r = await handleRequest(
    request(`/modules/${mod.id}/json-import/confirm`, { text: '{"bad":' }),
    db,
  );
  expect(r.status).toBe(422);
  const result = await r.json();
  expect(result.ok).toBe(false);
  expect(result.repairPrompt).toContain("ENTIRE corrected");
  expect(result.issues[0].path).toBe("$");
  expect(db.prepare("SELECT COUNT(*) n FROM papers").get()).toEqual({ n: 0 });
  expect(db.prepare("SELECT COUNT(*) n FROM documents").get()).toEqual({
    n: 0,
  });
  db.close();
});
test("portable image pages require matching local source PDFs and keep solution images out of the player", async () => {
  const { db, mod } = setup(),
    p = portablePaper();
  Object.assign(p.questions[0], {
    context: [
      { kind: "page", document: "question", page: 1, alt: "Source figure" },
    ],
  });
  Object.assign(p.questions[0].answer, {
    content: [
      { kind: "page", document: "solution", page: 1, alt: "Worked solution" },
    ],
  });
  const missing = await handleRequest(
    request(`/modules/${mod.id}/json-import/validate`, {
      text: JSON.stringify(p),
    }),
    db,
  );
  expect(missing.status).toBe(422);
  expect((await missing.json()).repairPrompt).toContain("PDF");
  const dir = mkdtempSync(`${tmpdir()}/import-pages-`),
    file = dir + "/source.pdf";
  execFileSync(".venv/bin/python", [
    "-c",
    "import pymupdf,sys;d=pymupdf.open();p=d.new_page();p.insert_text((72,72),'Local source');d.save(sys.argv[1])",
    file,
  ]);
  const docs = [];
  for (const role of ["question", "solution"] as const)
    docs.push(
      await saveDocument(db, mod.id, {
        name: "source.pdf",
        role,
        mime: "application/pdf",
        stream: new Blob([readFileSync(file)]).stream(),
      }),
    );
  const other = createModule(db, { code: "OTHER", title: "Other" });
  const cross = await handleRequest(
    request(`/modules/${other.id}/json-import/confirm`, {
      text: JSON.stringify(p),
      questionDocumentId: docs[0].id,
      solutionDocumentId: docs[1].id,
    }),
    db,
  );
  expect(cross.status).toBe(422);
  const input = {
    text: JSON.stringify(p),
    questionDocumentId: docs[0].id,
    solutionDocumentId: docs[1].id,
  };
  const r = await handleRequest(
    request(`/modules/${mod.id}/json-import/confirm`, input),
    db,
  );
  expect(r.status).toBe(201);
  const paper = await r.json();
  const s = await (
    await handleRequest(request(`/papers/${paper.id}/sessions`, {}), db)
  ).json();
  const solutionAsset = db
    .prepare("SELECT id FROM assets WHERE documentId=?")
    .get(docs[1].id) as { id: string };
  expect(JSON.stringify(s)).not.toContain(solutionAsset.id);
  const locked = await handleRequest(
    new Request(`http://127.0.0.1/api/assets/${solutionAsset.id}`),
    db,
  );
  expect(locked.status).toBe(404);
  Object.assign(p.questions[0], { questionPages: [99] });
  const badPage = await handleRequest(
    request(`/modules/${mod.id}/json-import/confirm`, {
      ...input,
      text: JSON.stringify(p),
    }),
    db,
  );
  expect(badPage.status).toBe(422);
  expect(db.prepare("SELECT COUNT(*) n FROM papers").get()).toEqual({ n: 1 });
  db.close();
});

test("legacy PDF repair cannot clear explanations or trigger paid regeneration on JSON papers", async () => {
  const { db, mod } = setup();
  const p = await (
    await handleRequest(
      request(`/modules/${mod.id}/json-import/confirm`, {
        text: JSON.stringify(portablePaper()),
      }),
      db,
    )
  ).json();
  const view = await (
    await handleRequest(
      new Request(`http://127.0.0.1/api/papers/${p.id}/review`),
      db,
    )
  ).json();
  const update = await handleRequest(
    new Request(`http://127.0.0.1/api/papers/${p.id}/review`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        revisionId: view.revision.id,
        expectedRevision: view.revision.version,
        content: { ...view.revision.content, explanations: [] },
      }),
    }),
    db,
  );
  expect(update.status).toBe(409);
  expect((await update.json()).error.code).toBe("json_import_read_only");
  const again = await (
    await handleRequest(
      new Request(`http://127.0.0.1/api/papers/${p.id}/review`),
      db,
    )
  ).json();
  expect(again.revision.content.explanations).toHaveLength(2);
  expect(again.revision.status).toBe("published");
  expect(db.prepare("SELECT COUNT(*) n FROM jobs").get()).toEqual({ n: 0 });
  db.close();
});

test("downloadable prompt examples import all supported response shapes without PDFs or provider jobs", async () => {
  const { db, mod } = setup();
  const exampleResponse = await handleRequest(
    new Request("http://127.0.0.1/api/import-format?download=example"),
    db,
  );
  const example = await exampleResponse.json();
  const response = await handleRequest(
    request(`/modules/${mod.id}/json-import/confirm`, {
      text: JSON.stringify(example),
    }),
    db,
  );
  expect(response.status).toBe(201);
  const paper = await response.json();
  const session = await (
    await handleRequest(request(`/papers/${paper.id}/sessions`, {}), db)
  ).json();
  expect(session.questions.map((q: { kind: string }) => q.kind).sort()).toEqual(
    ["multi_select", "single_select", "unsupported", "written"],
  );
  expect(session.progress.included).toBe(3);
  expect(session.progress.excluded).toBe(1);
  expect(db.prepare("SELECT COUNT(*) n FROM jobs").get()).toEqual({ n: 0 });
  db.close();
});

test("page-number citations alone never require PDF uploads for self-contained JSON", async () => {
  const { db, mod } = setup();
  const content = portablePaper();
  Object.assign(content.questions[0], {
    questionPages: [2, 3],
    answerPages: [4],
  });
  Object.assign(content.questions[1], { questionPages: [5], answerPages: [6] });
  const input = { text: JSON.stringify(content) };
  const validation = await handleRequest(
    request(`/modules/${mod.id}/json-import/validate`, input),
    db,
  );
  expect(validation.status).toBe(200);
  expect((await validation.json()).ok).toBe(true);
  const imported = await handleRequest(
    request(`/modules/${mod.id}/json-import/confirm`, input),
    db,
  );
  expect(imported.status).toBe(201);
  const paper = await imported.json();
  const review = await (
    await handleRequest(
      new Request(`http://127.0.0.1/api/papers/${paper.id}/review`),
      db,
    )
  ).json();
  expect(
    review.revision.content.questions.every(
      (q: { source: unknown[] }) => q.source.length === 0,
    ),
  ).toBe(true);
  expect(
    review.revision.content.answers.every(
      (a: { source: unknown[] }) => a.source.length === 0,
    ),
  ).toBe(true);
  expect(db.prepare("SELECT COUNT(*) n FROM jobs").get()).toEqual({ n: 0 });
  db.close();
});

test("unresolved image blocks explain the JSON-only remedy and remain blocked rather than disappearing", async () => {
  const { db, mod } = setup();
  const content = portablePaper();
  Object.assign(content.questions[0], {
    context: [
      { kind: "page", document: "question", page: 3, alt: "Essential circuit" },
    ],
  });
  const response = await handleRequest(
    request(`/modules/${mod.id}/json-import/confirm`, {
      text: JSON.stringify(content),
    }),
    db,
  );
  expect(response.status).toBe(422);
  const report = await response.json();
  expect(report.issues[0].message).toContain("image");
  expect(report.issues[0].message).toContain("JSON-only");
  expect(report.issues[0].message).toContain("Markdown");
  expect(report.repairPrompt).toContain("self-contained");
  expect(db.prepare("SELECT COUNT(*) n FROM papers").get()).toEqual({ n: 0 });
  db.close();
});
