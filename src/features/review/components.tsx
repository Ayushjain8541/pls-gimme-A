"use client";
import Link from "next/link";
import { useState, useEffect } from "react";
import {
  ChevronRight,
  ArrowRight,
  ExternalLink,
  Save,
  AlertCircle,
} from "lucide-react";
import { api, post, useApi } from "@/components/api";
import type {
  getLatestRevision,
  assetManifest,
} from "@/features/ingestion/pipeline";
import type {
  ParsedRevision,
  Question,
  ReferenceAnswer,
} from "@/domain/questions";
import type { Block } from "@/domain/content";
import type { Paper } from "@/features/documents/service";
import { RichContent } from "@/components/RichContent";
type ReviewView = {
  revision: ReturnType<typeof getLatestRevision>;
  assets: ReturnType<typeof assetManifest>;
  paper: Paper;
  importedJson?: boolean;
};
const text = (blocks: Block[]) =>
  blocks
    .filter((b) => b.kind === "markdown")
    .map((b) => b.text)
    .join("\n\n");
const replaceText = (blocks: Block[], value: string): Block[] => [
  { kind: "markdown", text: value },
  ...blocks.filter((b) => b.kind === "asset"),
];
export function Review({ paperId }: { paperId: string }) {
  const { data, error: loadError } = useApi<ReviewView>(
      `/api/papers/${paperId}/review`,
    ),
    [content, setContent] = useState<ParsedRevision | null>(null),
    [revision, setRevision] = useState<ReviewView["revision"] | null>(null),
    [checked, setChecked] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  useEffect(() => {
    if (data && !content) {
      setContent(data.revision.content);
      setRevision(data.revision);
    }
  }, [data, content]);
  function updateQuestion(id: string, patch: Partial<Question>) {
    setContent((c) =>
      c
        ? {
            ...c,
            questions: c.questions.map((q) =>
              q.id === id ? { ...q, ...patch } : q,
            ),
          }
        : c,
    );
  }
  function updateAnswer(q: Question, patch: Partial<ReferenceAnswer>) {
    setContent((c) => {
      if (!c) return c;
      const a = c.answers.find((a) => a.questionId === q.id) || {
        questionId: q.id,
        origin: data?.paper.solutionOrigin || "official",
        content: [{ kind: "markdown" as const, text: "" }],
        source: [],
        correctOptionIds: null,
        rubric: null,
        rubricOrigin: null,
      };
      return {
        ...c,
        answers: [
          ...c.answers.filter((a) => a.questionId !== q.id),
          { ...a, ...patch },
        ],
      };
    });
  }
  async function save(prepare: boolean) {
    if (!content || !revision) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const input = {
        ...content,
        issues: checked ? [] : content.issues,
        explanations: [],
      };
      const saved = await api<ReviewView["revision"]>(
        `/api/papers/${paperId}/review`,
        {
          method: "PUT",
          body: JSON.stringify({
            revisionId: revision.id,
            expectedRevision: revision.version,
            content: input,
          }),
        },
      );
      setRevision(saved);
      setContent(saved.content);
      if (prepare) {
        await post(`/api/papers/${paperId}/publish`, {
          draftId: saved.id,
          expectedRevision: saved.version,
        });
        setMessage(
          data?.importedJson
            ? "Saved and published with your supplied explanations. No AI conversion was run."
            : "Saved. Explanations are preparing in the background. Return to the module to see when it’s ready.",
        );
      } else
        setMessage(
          "Changes saved. Choose “Save and prepare” when you’re ready.",
        );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function reprocess() {
    setBusy(true);
    setError("");
    try {
      await post(`/api/papers/${paperId}/reprocess`);
      setMessage(
        "Converting the stored originals again. Return to the module to follow progress. Previous saved versions are preserved.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!data || !content)
    return (
      <p className={loadError ? "error" : "loading"}>
        {loadError || "Loading the converted paper…"}
      </p>
    );
  if (data.importedJson)
    return (
      <>
        <div className="breadcrumb">
          <Link href={`/modules/${data.paper.moduleId}`}>Module</Link>
          <ChevronRight size={12} />
          <span>Imported paper</span>
        </div>
        <h1>{data.paper.title}</h1>
        <p className="notice">
          To correct this paper, import a corrected JSON file from its module.
        </p>
        <p className="notice">
          This view is read-only so questions, reference answers and supplied
          explanations stay together. Your existing attempts keep their original
          revision.
        </p>
        <Link className="button" href={`/modules/${data.paper.moduleId}`}>
          Back to module
          <ArrowRight size={14} />
        </Link>
        {content.questions.map((q) => (
          <section className="review-item" key={q.id}>
            <h2>Question {q.number}</h2>
            <RichContent blocks={[...q.context, ...q.prompt]} review />
            {q.options.map((o) => (
              <div key={o.id}>
                <strong>{o.id}</strong>
                <RichContent blocks={o.content} review />
              </div>
            ))}
            {content.answers
              .filter((a) => a.questionId === q.id)
              .map((a) => (
                <div key={a.questionId}>
                  <h3>
                    Reference answer ·{" "}
                    {a.origin === "official"
                      ? "Course-provided"
                      : "AI-generated, unverified"}
                  </h3>
                  <RichContent blocks={a.content} review />
                </div>
              ))}
            {content.explanations
              .filter((e) => e.questionId === q.id)
              .map((e) => (
                <div key={e.questionId}>
                  <h3>Supplied explanation</h3>
                  <RichContent blocks={e.worked} review />
                </div>
              ))}
          </section>
        ))}
      </>
    );
  return (
    <>
      <div className="breadcrumb">
        <Link href={`/modules/${data.paper.moduleId}`}>Module</Link>
        <ChevronRight size={12} />
        <span>{data.paper.title}</span>
        <ChevronRight size={12} />
        <span>Resolve issues</span>
      </div>
      <div className="page-heading">
        <div>
          <div className="eyebrow">A QUICK REPAIR</div>
          <h1>Keep the original. Fix the details.</h1>
          <p>
            {data.paper.title} · Check flagged content against your source
            files.
          </p>
        </div>
        <div className="inline-actions">
          {!data.importedJson && (
            <button
              className="button"
              disabled={busy}
              onClick={() => void reprocess()}
            >
              Convert again
            </button>
          )}
          <a
            className="button"
            href={`/api/documents/${data.paper.questionDocumentId}/source?mode=review`}
            target="_blank"
            rel="noreferrer"
          >
            {data.importedJson ? "Original file" : "Original paper"}
            <ExternalLink size={13} />
          </a>
        </div>
      </div>
      {content.issues.length > 0 && (
        <section
          className="notice conversion-issues"
          aria-label="Conversion issues"
        >
          <strong>
            <AlertCircle size={14} /> {new Set(content.issues).size} conversion
            item{new Set(content.issues).size === 1 ? "" : "s"} need attention
          </strong>
          <p>
            These concern the conversion, not whether your original questions
            and answers are correct.
          </p>
          <ul>
            {[...new Set(content.issues)].slice(0, 4).map((issue, i) => (
              <li key={i}>{issue}</li>
            ))}
          </ul>
          {new Set(content.issues).size > 4 && (
            <details>
              <summary>Show all conversion issues</summary>
              <ul>
                {[...new Set(content.issues)].slice(4).map((issue, i) => (
                  <li key={i}>{issue}</li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
      {!!content.notes?.length && (
        <details className="notice conversion-notes">
          <summary>Preparation notes ({new Set(content.notes).size})</summary>
          <p>Informational only — these do not block practice.</p>
          <ul>
            {[...new Set(content.notes)].map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        </details>
      )}
      {data.paper.solutionDocumentId && (
        <a
          className="source-link"
          href={`/api/documents/${data.paper.solutionDocumentId}/source?mode=review`}
          target="_blank"
          rel="noreferrer"
        >
          Open original solution file
          <ExternalLink size={12} />
        </a>
      )}
      {content.questions.map((q) => {
        const a = content.answers.find((a) => a.questionId === q.id);
        return (
          <section key={q.id} className="review-item">
            <div className="review-top">
              <h2>Question {q.number}</h2>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={q.kind === "unsupported"}
                  onChange={(e) =>
                    updateQuestion(q.id, {
                      kind: e.target.checked
                        ? "unsupported"
                        : q.options.length
                          ? "single_select"
                          : "written",
                      requiresDrawing: e.target.checked,
                    })
                  }
                />
                Exclude unsupported question
              </label>
            </div>
            {q.context.length > 0 && (
              <div className="question-context">
                <RichContent blocks={q.context} review />
              </div>
            )}
            <label>
              Answer type
              <select
                value={q.kind}
                onChange={(e) =>
                  updateQuestion(q.id, {
                    kind: e.target.value as Question["kind"],
                    requiresDrawing: e.target.value === "unsupported",
                  })
                }
              >
                <option value="single_select">Single-choice MCQ</option>
                <option value="multi_select">Multiple-choice MCQ</option>
                <option value="written">Typed answer</option>
                <option value="unsupported">
                  Exclude unsupported question
                </option>
              </select>
            </label>
            <label>
              Question text
              <textarea
                value={text(q.prompt)}
                onChange={(e) =>
                  updateQuestion(q.id, {
                    prompt: replaceText(q.prompt, e.target.value),
                  })
                }
              />
            </label>
            {q.prompt.some((b) => b.kind === "asset") && (
              <RichContent
                blocks={q.prompt.filter((b) => b.kind === "asset")}
                review
              />
            )}
            {q.options.map((o, i) => (
              <label key={o.id}>
                Option {o.id}
                <input
                  value={text(o.content)}
                  onChange={(e) =>
                    updateQuestion(q.id, {
                      options: q.options.map((x, j) =>
                        j === i
                          ? {
                              ...x,
                              content: replaceText(x.content, e.target.value),
                            }
                          : x,
                      ),
                    })
                  }
                />
              </label>
            ))}
            {q.kind !== "unsupported" && (
              <>
                <label>
                  Reference answer
                  <textarea
                    value={a ? text(a.content) : ""}
                    onChange={(e) =>
                      updateAnswer(q, {
                        content: replaceText(a?.content || [], e.target.value),
                      })
                    }
                  />
                </label>
                {q.kind.includes("select") && (
                  <label>
                    Correct option
                    {q.kind === "multi_select" ? "s (comma-separated)" : ""}
                    <input
                      value={a?.correctOptionIds?.join(", ") || ""}
                      onChange={(e) =>
                        updateAnswer(q, {
                          correctOptionIds: e.target.value
                            .split(",")
                            .map((x) => x.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  </label>
                )}
                <label>
                  Solution origin
                  <select
                    value={a?.origin || data.paper.solutionOrigin || "official"}
                    onChange={(e) =>
                      updateAnswer(q, {
                        origin: e.target.value as "official" | "external_ai",
                      })
                    }
                  >
                    <option value="official">
                      Official / provided by course
                    </option>
                    <option value="external_ai">AI-generated externally</option>
                  </select>
                </label>
              </>
            )}
          </section>
        );
      })}
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
        />
        I’ve checked the flagged items and corrected or excluded anything
        unresolved.
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      <div className="question-footer">
        <Link className="button" href={`/modules/${data.paper.moduleId}`}>
          Back to module
        </Link>
        <div className="inline-actions">
          <button
            className="button"
            disabled={busy}
            onClick={() => void save(false)}
          >
            <Save size={13} />
            Save changes
          </button>
          <button
            className="button primary"
            disabled={busy}
            onClick={() => void save(true)}
          >
            Save and prepare
            <ArrowRight size={13} />
          </button>
        </div>
      </div>
    </>
  );
}
