import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AppDb } from "../../server/db/client";
import { one } from "../../server/db/queries";
import { AppError } from "../../server/errors";
import { pythonBin } from "../../server/config";
import { getDocument, storageDir } from "../documents/service";
const run = promisify(execFile);
const PageSchema = z.object({
  page: z.number().int().positive(),
  width: z.number().positive(),
  height: z.number().positive(),
  text: z.string(),
  textBlocks: z.array(
    z.object({ bbox: z.array(z.number()), text: z.string() }),
  ),
  file: z.string(),
});
export type ExtractedPage = z.infer<typeof PageSchema> & {
  pageAssetId: string;
  imagePath: string;
};
export type ExtractedDocument = { documentId: string; pages: ExtractedPage[] };
export async function extractPdf(
  db: AppDb,
  documentId: string,
): Promise<ExtractedDocument> {
  const cached = one<{ contentJson: string }>(
    db,
    "SELECT contentJson FROM extractionCache WHERE documentId=? AND version='pdf-v1'",
    documentId,
  );
  if (cached) return JSON.parse(cached.contentJson);
  const d = getDocument(db, documentId);
  if (d.mime !== "application/pdf")
    throw new AppError("invalid_pdf", "Expected a PDF.");
  const out = path.join(storageDir(db), `${d.id}-pages`);
  mkdirSync(out, { recursive: true });
  let stdout: string;
  try {
    ({ stdout } = await run(
      pythonBin(),
      [
        path.resolve("scripts/pdf/extract.py"),
        "--input",
        path.join(storageDir(db), d.storageKey),
        "--out",
        out,
      ],
      { timeout: 60000, maxBuffer: 20 * 1024 * 1024 },
    ));
  } catch (e) {
    const output = (e as { stdout?: string }).stdout || "";
    if (output.includes("encrypted_pdf"))
      throw new AppError(
        "encrypted_pdf",
        "This PDF is password protected. Upload an unlocked copy.",
      );
    if (output.includes("page_limit"))
      throw new AppError(
        "page_limit",
        "PDFs must have between 1 and 100 pages.",
        413,
      );
    throw new AppError(
      "pdf_failed",
      "Could not read this PDF. Check the PDF and Python setup.",
    );
  }
  const parsed = z
    .object({ pages: z.array(PageSchema).min(1).max(100) })
    .parse(JSON.parse(stdout));
  const pages = parsed.pages.map((p) => {
    if (p.file !== `page-${p.page}.png`)
      throw new AppError("invalid_asset", "Unexpected PDF asset.");
    const key = `${d.id}-pages/${p.file}`;
    db.prepare("INSERT OR IGNORE INTO assets VALUES(?,?,?,?,?)").run(
      randomUUID(),
      d.id,
      d.role,
      p.page,
      key,
    );
    const asset = one<{ id: string }>(
      db,
      "SELECT id FROM assets WHERE documentId=? AND page=?",
      d.id,
      p.page,
    )!;
    return {
      ...p,
      pageAssetId: asset.id,
      imagePath: path.join(storageDir(db), key),
    };
  });
  const result = { documentId, pages };
  db.prepare(
    "INSERT INTO extractionCache VALUES(?,'pdf-v1',?) ON CONFLICT(documentId) DO UPDATE SET version=excluded.version,contentJson=excluded.contentJson",
  ).run(documentId, JSON.stringify(result));
  return result;
}
