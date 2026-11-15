import busboy from "busboy";
import { Readable, Transform } from "node:stream";
import type { AppDb } from "../../server/db/client";
import { saveDocument, type DocumentMeta } from "./service";
import { AppError } from "../../server/errors";
export async function uploadMultipart(
  db: AppDb,
  moduleId: string,
  req: Request,
  role: "question" | "solution",
): Promise<DocumentMeta> {
  if (!req.body) throw new AppError("empty_file", "Choose a file.");
  const max = 26 * 1024 * 1024;
  if (Number(req.headers.get("content-length")) > max)
    throw new AppError(
      "too_large",
      "Upload one file at a time, up to 25 MiB.",
      413,
    );
  return new Promise((resolve, reject) => {
    let upload: Promise<DocumentMeta> | undefined;
    let bytes = 0;
    const parser = busboy({
      headers: { "content-type": req.headers.get("content-type") || "" },
      limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 2, parts: 3 },
    });
    const source = Readable.fromWeb(
      req.body as import("node:stream/web").ReadableStream,
    );
    const limit = new Transform({
      transform(chunk, _encoding, cb) {
        bytes += chunk.length;
        cb(
          bytes > max
            ? new AppError("too_large", "File is too large.", 413)
            : null,
          chunk,
        );
      },
    });
    const fail = (err: unknown) => {
      source.destroy();
      limit.destroy();
      parser.destroy();
      reject(err);
    };
    parser.on("file", (_field, file, info) => {
      file.on("limit", () =>
        file.destroy(new AppError("too_large", "PDF limit is 25 MiB.", 413)),
      );
      upload = saveDocument(db, moduleId, {
        name: info.filename || "upload",
        mime: info.mimeType,
        role,
        stream: Readable.toWeb(file) as ReadableStream<Uint8Array>,
      });
      upload.catch(fail);
    });
    parser.on("filesLimit", () =>
      fail(new AppError("too_many_files", "Upload one file per request.")),
    );
    parser.on("error", reject);
    source.on("error", reject);
    limit.on("error", fail);
    parser.on("close", () => {
      if (upload) upload.then(resolve, reject);
      else reject(new AppError("empty_file", "Choose a file."));
    });
    source.pipe(limit).pipe(parser);
  });
}
