import type { AppDb } from "../../server/db/client";
import { one } from "../../server/db/queries";
import { AppError } from "../../server/errors";
import { getModule } from "../library/service";
import { getDocument } from "./service";
import { extractPdf } from "../ingestion/pdf";
/** Export the existing local text layer verbatim; no model, OCR or question splitting. */
export async function sourceMarkdown(
  db: AppDb,
  moduleId: string,
  documentId: string,
) {
  getModule(db, moduleId);
  const doc = getDocument(db, documentId);
  if (doc.moduleId !== moduleId)
    throw new AppError(
      "not_found",
      "Source file not found in this module.",
      404,
    );
  if (
    doc.mime !== "application/pdf" ||
    !["question", "solution"].includes(doc.role)
  )
    throw new AppError(
      "unsupported_file",
      "Choose a question or answer-key PDF.",
    );
  const extracted = await extractPdf(db, documentId);
  const source = one<{ hash: string }>(
    db,
    "SELECT hash FROM documents WHERE id=?",
    documentId,
  )!;
  const sections = [
    "# Page-marked PDF source transcript",
    `Source filename: ${JSON.stringify(doc.originalName)}\nDocument role: ${doc.role}\nSource SHA-256: ${source.hash}\nPhysical PDF pages: ${extracted.pages.length}`,
    "Local embedded-text extraction only: no LLM, OCR, summarization, question splitting or answer generation. This is a source aid, not practice JSON. Check the original PDF for figures, scanned text, table layout, equations and code-label alignment. Text-layer reading order and glyphs can differ from the visible page. Preserve the wording; do not replace it with a summary.",
  ];
  for (const page of extracted.pages) {
    sections.push(`## PDF page ${page.page}`);
    if (!page.text.trim()) {
      sections.push(
        "No embedded text was detected on this page. It may be blank, scanned or image-only. Inspect the original PDF; this export did not perform OCR.",
      );
      continue;
    }
    // A longer fence keeps source backticks from becoming transcript structure.
    let longest = 0;
    for (const match of page.text.matchAll(/`+/g))
      longest = Math.max(longest, match[0].length);
    const fence = "`".repeat(Math.max(3, longest + 1));
    sections.push(
      `${fence}text\n${page.text}${page.text.endsWith("\n") ? "" : "\n"}${fence}`,
    );
  }
  const markdown = sections.join("\n\n") + "\n";
  if (Buffer.byteLength(markdown) > 20 * 1024 * 1024)
    throw new AppError(
      "too_large",
      "The extracted source is too large for one Markdown download.",
      413,
    );
  return {
    markdown,
    filename: doc.originalName.replace(/\.pdf$/i, "") + "-source.md",
  };
}
