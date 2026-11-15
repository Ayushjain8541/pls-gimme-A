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
