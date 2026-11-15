import { readFileSync } from "node:fs";
import path from "node:path";
import type { AiInput, AiInputContent } from "./gateway";
import type { AppDb } from "../db/client";
import { one } from "../db/queries";
import { AppError, requireValue } from "../errors";
import { storageDir } from "../../features/documents/service";
/** Attach only referenced local assets, with labels matching the structured content. */
export function visualInputs(db: AppDb, value: unknown): AiInput {
  const ids = new Set<string>();
  function walk(node: unknown) {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object") {
      const object = node as Record<string, unknown>;
      if (object.kind === "asset" && typeof object.assetId === "string")
        ids.add(object.assetId);
      if (
        typeof object.documentId === "string" &&
        typeof object.page === "number"
      ) {
        const asset = one<{ id: string }>(
          db,
          "SELECT a.id FROM assets a JOIN documents d ON d.id=a.documentId WHERE a.documentId=? AND a.page=? AND d.ownerId=?",
          object.documentId,
          object.page,
          "local",
        );
        if (asset) ids.add(asset.id);
      }
      Object.values(object).forEach(walk);
    }
  }
  walk(value);
  if (!ids.size) return [];
  const content: AiInputContent[] = [];
  let total = 0;
  for (const id of ids) {
    const a = requireValue(
      one<{
        storageKey: string;
        role: string;
        documentId: string;
        page: number;
      }>(
        db,
        "SELECT a.storageKey,a.role,a.documentId,a.page FROM assets a JOIN documents d ON d.id=a.documentId WHERE a.id=? AND d.ownerId=?",
        id,
        "local",
      ),
      "A referenced figure is missing.",
    );
    const image = readFileSync(path.join(storageDir(db), a.storageKey));
    total += image.length;
    if (total > 20 * 1024 * 1024)
      throw new AppError(
        "visual_limit",
        "The referenced figures exceed the per-question AI image limit. Review or exclude this item.",
        413,
      );
    content.push({
      type: "input_text",
      text: JSON.stringify({
        assetId: id,
        role: a.role,
        documentId: a.documentId,
        page: a.page,
      }),
    });
    content.push({
      type: "input_image",
      image_url: `data:image/png;base64,${image.toString("base64")}`,
      detail: "auto",
    });
  }
  return [{ role: "user", content }];
}
