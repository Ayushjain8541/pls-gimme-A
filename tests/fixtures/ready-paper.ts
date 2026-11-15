import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { openDb } from "../../src/server/db/client";
import { createModule } from "../../src/features/library/service";
import {
  saveDocument,
  createPaper,
} from "../../src/features/documents/service";
import {
  saveRevision,
  publishRevision,
} from "../../src/features/review/repository";
import { fixtureRevision } from "./paper";
export async function readyPaper() {
  const db = openDb(mkdtempSync(`${tmpdir()}/practice-`) + "/db");
  const mod = createModule(db, {
    code: "CS2100",
    title: "Computer Organisation",
  });
  const q = await saveDocument(db, mod.id, {
    name: "2526.pdf",
    role: "question",
    mime: "application/pdf",
    stream: new Blob(["%PDF-1.4\nfixture"]).stream(),
  });
  const a = await saveDocument(db, mod.id, {
    name: "2526-key.md",
    role: "solution",
    mime: "text/markdown",
    stream: new Blob(["1. A\n2(a). Zero."]).stream(),
  });
  const paper = createPaper(db, mod.id, {
    title: "2526",
    questionDocumentId: q.id,
    solutionDocumentId: a.id,
    solutionOrigin: "official",
  });
  const revision = saveRevision(db, paper.id, fixtureRevision());
  publishRevision(db, paper.id, revision.id, revision.version);
  return { db, module: mod, paper, revision };
}
