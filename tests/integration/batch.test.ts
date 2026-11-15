import { test, expect } from "vitest";
import { readyPaper } from "../fixtures/ready-paper";
import { saveDocument } from "../../src/features/documents/service";
import { suggestPairs, confirmBatch } from "../../src/features/batch/service";
test("batch pairs by name, needs confirmation, and confirmation is idempotent", async () => {
  const { db, module } = await readyPaper();
  const ids: string[] = [];
  for (let i = 0; i < 10; i++) {
    for (const role of ["solution", "question"] as const) {
      const name = `paper-${i}${role === "solution" ? "-answers" : ""}.pdf`;
      const d = await saveDocument(db, module.id, {
        name,
        role,
        mime: "application/pdf",
        stream: new Blob([`%PDF-1.4 ${i} ${role}`]).stream(),
      });
      ids.push(d.id);
    }
  }
  const proposal = suggestPairs(db, module.id, ids);
  expect(proposal).toHaveLength(10);
  expect(proposal.every((p) => p.solutionDocumentId)).toBe(true);
  const input = {
    requestId: "batch1",
    pairs: proposal.map((p) => ({
      ...p,
      title: "Paper",
      solutionOrigin: "official" as const,
    })),
  };
  const first = confirmBatch(db, module.id, input);
  const second = confirmBatch(db, module.id, input);
  expect(new Set(first.jobIds).size).toBe(10);
  expect(second).toEqual(first);
  db.close();
});

test("ambiguous filenames remain unpaired and a failed pair rolls back the entire confirmation", async () => {
  const { db, module } = await readyPaper();
  const docs: Awaited<ReturnType<typeof saveDocument>>[] = [];
  for (const [name, role, content] of [
    ["exam.pdf", "question", "q"],
    ["exam-answers.pdf", "solution", "a1"],
    ["exam-solutions.pdf", "solution", "a2"],
  ] as const)
    docs.push(
      await saveDocument(db, module.id, {
        name,
        role,
        mime: "application/pdf",
        stream: new Blob([`%PDF-1.4 ${content}`]).stream(),
      }),
    );
  const proposed = suggestPairs(
    db,
    module.id,
    docs.map((d) => d.id),
  );
  expect(proposed[0].solutionDocumentId).toBeNull();
  const before = (
    db.prepare("SELECT count(*) AS n FROM papers").get() as { n: number }
  ).n;
  expect(() =>
    confirmBatch(db, module.id, {
      requestId: "bad",
      pairs: [
        {
          title: "valid",
          questionDocumentId: docs[0].id,
          solutionDocumentId: null,
          solutionOrigin: null,
        },
        {
          title: "bad",
          questionDocumentId: "not-a-document",
          solutionDocumentId: null,
          solutionOrigin: null,
        },
      ],
    }),
  ).toThrow();
  expect(
    (db.prepare("SELECT count(*) AS n FROM papers").get() as { n: number }).n,
  ).toBe(before);
  db.close();
});
