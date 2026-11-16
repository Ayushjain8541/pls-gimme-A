import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getDb, type AppDb } from "./db/client";
import { one } from "./db/queries";
import { checkLocalRequest, errorResponse, readJson } from "./http";
import { AppError, requireValue } from "./errors";
import { aiConfigured } from "./config";
import {
  listModules,
  createModule,
  getModule,
  listPapers,
} from "../features/library/service";
import { uploadMultipart } from "../features/documents/upload";
import {
  createPaper,
  getPaper,
  attachSolution,
  readSource,
  storageDir,
} from "../features/documents/service";
import { buildExternalSolutionPrompt } from "../features/documents/solution-prompt";
import { suggestPairs, confirmBatch } from "../features/batch/service";
import {
  getLatestRevision,
  assetManifest,
  validateSources,
} from "../features/ingestion/pipeline";
import { saveRevision } from "../features/review/repository";
import { RevisionSchema, validateRevision } from "../domain/questions";
import { enqueueJob, retryJob, type Job } from "../features/jobs/service";
import {
  startSession,
  getSession,
  saveItem,
  submitAttempt,
  getAttempt,
  requestAiAssessment,
} from "../features/practice/service";
import { getSummary } from "../features/practice/summary";
import {
  askFollowup,
  getMessages,
  flagDisputed,
} from "../features/followup/service";
import { reprocessPaper } from "../features/ingestion/reprocess";
import {
  prepareJsonImport,
  importJsonPaper,
  isJsonPaper,
} from "../features/json-import/service";
import {
  conversionPrompt,
  formatExample,
  portableJsonSchema,
} from "../features/json-import/contract";
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
export async function handleRequest(
  req: Request,
  connection?: AppDb,
): Promise<Response> {
  try {
    checkLocalRequest(req);
    const db = connection || getDb(),
      url = new URL(req.url),
      p = url.pathname.split("/").filter(Boolean).slice(1),
      method = req.method;
    const body = () => readJson(req);
    if (p[0] === "status" && method === "GET")
      return json({ aiConfigured: aiConfigured() });
    if (p[0] === "import-format" && method === "GET") {
      const download = url.searchParams.get("download");
      if (download && ["prompt", "example", "schema"].includes(download))
        return new Response(
          download === "prompt"
            ? conversionPrompt
            : JSON.stringify(
                download === "schema" ? portableJsonSchema : formatExample,
                null,
                2,
              ),
          {
            headers: {
              "Content-Type":
                download === "prompt"
                  ? "text/plain; charset=utf-8"
                  : "application/json",
              "Content-Disposition": `attachment; filename="gimme-a-${download}.${download === "prompt" ? "txt" : "json"}"`,
            },
          },
        );
      return json({ prompt: conversionPrompt, example: formatExample });
    }
    if (p[0] === "modules") {
      if (p.length === 1) {
        if (method === "GET") return json(listModules(db));
        if (method === "POST") return json(createModule(db, await body()), 201);
      }
      const moduleId = p[1];
      if (p.length === 2 && method === "GET")
        return json(getModule(db, moduleId));
      if (p[2] === "json-import" && method === "POST") {
        const input = await readJson(req, 12 * 1024 * 1024);
        if (p[3] === "validate") {
          const result = await prepareJsonImport(db, moduleId, input);
          return json(
            result.ok ? { ok: true, summary: result.summary } : result,
            result.ok ? 200 : 422,
          );
        }
        if (p[3] === "confirm") {
          const result = await importJsonPaper(db, moduleId, input);
          return json(
            result.ok ? result.paper : result,
            result.ok ? (result.reused ? 200 : 201) : 422,
          );
        }
      }
      if (p[2] === "papers") {
        if (method === "GET") return json(listPapers(db, moduleId));
        if (method === "POST")
          return json(createPaper(db, moduleId, await body()), 201);
      }
      if (p[2] === "documents" && method === "POST")
        return json(
          await uploadMultipart(
            db,
            moduleId,
            req,
            z
              .enum(["question", "solution"])
              .parse(url.searchParams.get("role")),
          ),
          201,
        );
      if (p[2] === "batch" && method === "POST") {
        const input = await body();
        if (p[3] === "preview")
          return json(
            suggestPairs(
              db,
              moduleId,
              z.array(z.string()).parse(input.documentIds),
            ),
          );
        if (p[3] === "confirm")
          return json(confirmBatch(db, moduleId, input), 202);
      }
    }
    if (p[0] === "papers") {
      const id = p[1],
        paper = getPaper(db, id);
      if (p.length === 2 && method === "GET")
        return json({
          ...paper,
          solutionPrompt: buildExternalSolutionPrompt(paper.title),
          job: one(
            db,
            "SELECT id,status,stage,errorMessage FROM jobs WHERE json_extract(payload,'$.paperId')=? ORDER BY rowid DESC LIMIT 1",
            id,
          ),
        });
      if (p[2] === "reprocess" && method === "POST")
        return json(reprocessPaper(db, id), 202);
      if (p[2] === "solutions" && method === "POST")
        return json(
          attachSolution(
            db,
            id,
            z
              .object({
                documentId: z.string(),
                origin: z.enum(["official", "external_ai"]),
              })
              .parse(await body()),
          ),
          202,
        );
      if (p[2] === "sessions" && method === "POST") {
        const input = z
          .object({ restart: z.boolean().optional() })
          .parse(await body());
        return json(startSession(db, id, input.restart || false));
      }
      if (p[2] === "review") {
        if (method === "GET")
          return json({
            revision: getLatestRevision(db, id),
            assets: assetManifest(db, id),
            paper,
            importedJson: isJsonPaper(db, id),
          });
        if (method === "PUT") {
          const input = z
            .object({
              revisionId: z.string(),
              expectedRevision: z.number().int(),
              content: RevisionSchema,
            })
            .parse(await body());
          const errors = validateSources(db, input.content, id);
          if (errors.length)
            throw new AppError("invalid_source", errors.join("\n"));
          const saved = saveRevision(
            db,
            id,
            input.content,
            input.revisionId,
            input.expectedRevision,
          );
          return json(saved);
        }
      }
      if (p[2] === "publish" && method === "POST") {
        const input = z
            .object({ draftId: z.string(), expectedRevision: z.number().int() })
            .parse(await body()),
          r = getLatestRevision(db, id);
        if (
          r.id !== input.draftId ||
          r.version !== input.expectedRevision ||
          r.status !== "draft"
        )
          throw new AppError(
            "version_conflict",
            "Reload the latest paper before preparing it.",
            409,
          );
        const valid = validateRevision(r.content);
        if (!valid.ok)
          throw new AppError("needs_review", valid.issues.join("\n"), 409);
        if (isJsonPaper(db, id)) {
          const ready = validateRevision(r.content, true);
          if (!ready.ok)
            throw new AppError("needs_review", ready.issues.join("\n"), 409);
          const { publishRevision } =
            await import("../features/review/repository");
          publishRevision(db, id, r.id, r.version);
          return json({ published: true });
        }
        const j = enqueueJob(db, "ingest", `publish:${r.id}:${r.version}`, {
          paperId: id,
          draftId: r.id,
          expectedVersion: r.version,
        });
        db.prepare("UPDATE papers SET state='queued' WHERE id=?").run(id);
        return json({ jobId: j.id }, 202);
      }
    }
    if (p[0] === "sessions") {
      const id = p[1];
      if (p.length === 2 && method === "GET") return json(getSession(db, id));
      if (p[2] === "summary" && method === "GET")
        return json(getSummary(db, id));
      if (p[2] === "items" && method === "PUT")
        return json(saveItem(db, id, p[3], await body()));
      if (p[2] === "attempts" && method === "POST")
        return json(submitAttempt(db, id, await body()), 202);
    }
    if (p[0] === "attempts") {
      const id = p[1];
      if (p.length === 2 && method === "GET") return json(getAttempt(db, id));
      if (p[2] === "assess" && method === "POST")
        return json(requestAiAssessment(db, id), 202);
      if (p.length === 2 && method === "PATCH") {
        z.object({ disputed: z.literal(true) }).parse(await body());
        flagDisputed(db, id);
        return json({ ok: true });
      }
      if (p[2] === "messages") {
        if (method === "GET") return json(getMessages(db, id));
        if (method === "POST")
          return json(askFollowup(db, id, await body()), 202);
      }
    }
    if (p[0] === "jobs") {
      const id = p[1],
        job = requireValue(one<Job>(db, "SELECT * FROM jobs WHERE id=?", id));
      if (p[2] === "retry" && method === "POST")
        return json(retryJob(db, id), 202);
      if (method === "GET")
        return json({
          id: job.id,
          status: job.status,
          stage: job.stage,
          errorMessage: job.errorMessage,
        });
    }
    if (p[0] === "documents" && p[2] === "source" && method === "GET") {
      const mode = z
        .enum(["question", "review", "attempt"])
        .parse(url.searchParams.get("mode") || "question");
      const f = readSource(
        db,
        p[1],
        mode,
        url.searchParams.get("attemptId") || undefined,
      );
      return new Response(readFileSync(f.path), {
        headers: {
          "Content-Type": f.mime,
          "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "no-store",
        },
      });
    }
    if (p[0] === "assets" && method === "GET") {
      const asset = requireValue(
        one<{
          id: string;
          documentId: string;
          storageKey: string;
          role: string;
        }>(db, "SELECT * FROM assets WHERE id=?", p[1]),
      );
      readSource(
        db,
        asset.documentId,
        asset.role === "question"
          ? "question"
          : url.searchParams.get("review") === "true"
            ? "review"
            : "attempt",
        url.searchParams.get("attemptId") || undefined,
      );
      return new Response(
        readFileSync(path.join(storageDir(db), asset.storageKey)),
        {
          headers: {
            "Content-Type": "image/png",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          },
        },
      );
    }
    throw new AppError("not_found", "Page not found.", 404);
  } catch (e) {
    return errorResponse(e);
  }
}
