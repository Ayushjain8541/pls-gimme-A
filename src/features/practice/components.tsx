"use client";
import Link from "next/link";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronRight,
  ArrowLeft,
  ArrowRight,
  Send,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  RotateCcw,
  MessageCircle,
} from "lucide-react";
import { api, post, useApi } from "@/components/api";
import { RichContent } from "@/components/RichContent";
import { StatusBadge } from "@/components/StatusBadge";
import type { getSession, AttemptView } from "./service";
import type { StudentResponse } from "@/domain/practice";
import type { getSummary } from "./summary";
import type { ChatMessage } from "@/features/followup/service";
type SessionView = ReturnType<typeof getSession>;
type PlayerItem = SessionView["questions"][number];
export function Player({ paperId }: { paperId: string }) {
  const [session, setSession] = useState<SessionView | null>(null),
    [position, setPosition] = useState(0),
    [error, setError] = useState("");
  const sessionId = useRef<string | null>(null);
  const load = useCallback(async () => {
    if (!sessionId.current) return;
    const s = await api<SessionView>(`/api/sessions/${sessionId.current}`);
    setSession(s);
    return s;
  }, []);
  useEffect(() => {
    let alive = true;
    post<SessionView>(`/api/papers/${paperId}/sessions`)
      .then((s) => {
        if (alive) {
          sessionId.current = s.id;
          setSession(s);
          setPosition(s.position);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [paperId]);
  useEffect(() => {
    const timer = setInterval(() => {
      void load().catch((e) => setError(e.message));
    }, 2000);
    return () => clearInterval(timer);
  }, [load]);
  async function restart() {
    if (
      !window.confirm(
        "Start a new attempt? Your previous attempts will remain saved.",
      )
    )
      return;
    try {
      const s = await post<SessionView>(`/api/papers/${paperId}/sessions`, {
        restart: true,
      });
      sessionId.current = s.id;
      setSession(s);
      setPosition(0);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (!session)
    return (
      <>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : (
          <p className="loading">Opening your practice session…</p>
        )}
        <Link href="/" className="source-link">
          Back to modules
        </Link>
      </>
    );
  const q = session.questions[position];
  return (
    <>
      <div className="breadcrumb">
        <Link href="/">My modules</Link>
        <ChevronRight size={12} />
        <Link href={`/modules/${session.moduleId}`}>Module</Link>
        <ChevronRight size={12} />
        <span>{session.title}</span>
      </div>
      <div className="page-heading player-heading">
        <div>
          <div className="eyebrow">ONE QUESTION CLOSER</div>
          <h1>{session.title}</h1>
          <p>
            {session.progress.submitted} of {session.progress.included}{" "}
            questions answered · Your progress is saved
          </p>
        </div>
        <div className="inline-actions">
          <StatusBadge state={session.progress.state} />
          <button
            className="icon-button"
            aria-label="Start a new attempt"
            title="Start a new attempt"
            onClick={() => void restart()}
          >
            <RotateCcw size={15} />
          </button>
        </div>
      </div>
      {session.hasNewRevision && (
        <div className="notice">
          This paper has an updated version. You’re continuing your saved
          version. Start a new attempt to use the update.
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="player-grid">
        <aside className="question-nav">
          <strong>YOUR QUESTIONS</strong>
          <div className="question-index">
            {session.questions.map((item, i) => (
              <button
                key={item.id}
                aria-label={`Go to question ${item.number}`}
                className={`${item.attempt?.status === "succeeded" ? "done" : ""} ${item.excluded ? "excluded" : ""} ${i === position ? "current" : ""}`}
                onClick={() =>
                  document.dispatchEvent(
                    new CustomEvent("practice:navigate", { detail: i }),
                  )
                }
              >
                {item.number}
              </button>
            ))}
          </div>
          <p className="nav-legend">
            Green · Answered
            <br />
            Crossed out · Excluded
            <br />
            Your pace. Your progress.
          </p>
          <div className="progress-track" style={{ marginTop: 15 }}>
            <div
              style={{
                width: `${session.progress.included ? (session.progress.assessed / session.progress.included) * 100 : 0}%`,
              }}
            />
          </div>
        </aside>
        <div>
          {q && (
            <QuestionPanel
              key={`${session.id}:${q.id}`}
              question={q}
              session={session}
              position={position}
              onNavigate={setPosition}
              onRefresh={load}
            />
          )}
        </div>
      </div>
    </>
  );
}
function QuestionPanel({
  question: q,
  session,
  position,
  onNavigate,
  onRefresh,
}: {
  question: PlayerItem;
  session: SessionView;
  position: number;
  onNavigate: (n: number) => void;
  onRefresh: () => Promise<SessionView | undefined>;
}) {
  const router = useRouter();
  const empty: StudentResponse = q.kind.includes("select")
    ? { kind: "selection", optionIds: [] }
    : { kind: "written", text: "" };
  const [response, setResponse] = useState<StudentResponse>(
      q.draft || q.attempt?.response || empty,
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saveStatus, setSaveStatus] = useState(""),
    [reattempt, setReattempt] = useState(false);
  const responseRef = useRef(response),
    version = useRef(q.draftVersion),
    dirty = useRef(false),
    pending = useRef(Promise.resolve()),
    requestId = useRef(crypto.randomUUID()),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    mounted = useRef(true);
  const shownAttempt = reattempt ? null : q.attempt;
  const hasResponse =
    response.kind === "selection"
      ? response.optionIds.length > 0
      : response.text.trim().length > 0;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  useEffect(() => {
    if (!dirty.current && q.draftVersion > version.current) {
      const incoming: StudentResponse =
        q.draft ||
        q.attempt?.response ||
        (q.kind.includes("select")
          ? { kind: "selection", optionIds: [] }
          : { kind: "written", text: "" });
      responseRef.current = incoming;
      setResponse(incoming);
      version.current = q.draftVersion;
    }
  }, [q.draftVersion, q.draft, q.attempt?.response, q.kind]);
  const save = useCallback(
    async (extra: Record<string, unknown> = {}) => {
      if (timer.current) clearTimeout(timer.current);
      const captured = responseRef.current;
      const valid =
        captured.kind === "selection"
          ? captured.optionIds.length > 0
          : !!captured.text.trim();
      let failed: unknown;
      pending.current = pending.current
        .catch(() => {})
        .then(async () => {
          try {
            if (mounted.current) setSaveStatus("Saving…");
            const result = await api<{ draftVersion: number }>(
              `/api/sessions/${session.id}/items/${q.id}`,
              {
                method: "PUT",
                body: JSON.stringify({
                  expectedDraftVersion: version.current,
                  ...(dirty.current ? { draft: valid ? captured : null } : {}),
                  ...extra,
                }),
              },
            );
            version.current = result.draftVersion;
            if (
              JSON.stringify(responseRef.current) === JSON.stringify(captured)
            )
              dirty.current = false;
            if (mounted.current) setSaveStatus("Saved");
          } catch (e) {
            failed = e;
            if (mounted.current) {
              setError((e as Error).message);
              setSaveStatus("Not saved");
            }
            throw e;
          }
        });
      await pending.current.catch(() => {});
      if (failed) throw failed;
    },
    [session.id, q.id],
  );
  function change(next: StudentResponse) {
    responseRef.current = next;
    setResponse(next);
    dirty.current = true;
    requestId.current = crypto.randomUUID();
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void save().catch(() => {});
    }, 400);
  }
  const navigate = useCallback(
    async (n: number, skipReason?: "later" | "drawing") => {
      if (n < 0 || n >= session.questions.length) return;
      setBusy(true);
      setError("");
      try {
        await save({
          position: n,
          ...(skipReason
            ? {
                skipReason,
                ...(skipReason === "drawing" ? { excluded: true } : {}),
              }
            : {}),
        });
        await onRefresh();
        onNavigate(n);
      } catch {
      } finally {
        if (mounted.current) setBusy(false);
      }
    },
    [save, onRefresh, onNavigate, session.questions.length],
  );
  useEffect(() => {
    const handler = (e: Event) => {
      void navigate((e as CustomEvent<number>).detail);
    };
    document.addEventListener("practice:navigate", handler);
    return () => document.removeEventListener("practice:navigate", handler);
  }, [navigate]);
  async function submit() {
    setBusy(true);
    setError("");
    try {
      await save();
      await post(`/api/sessions/${session.id}/attempts`, {
        questionId: q.id,
        response: responseRef.current,
        requestId: requestId.current,
      });
      setReattempt(false);
      await onRefresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function skip(drawing: boolean) {
    if (position < session.questions.length - 1) {
      await navigate(position + 1, drawing ? "drawing" : "later");
      return;
    }
    setBusy(true);
    try {
      await save({
        skipReason: drawing ? "drawing" : "later",
        ...(drawing ? { excluded: true } : {}),
      });
      await onRefresh();
      router.push(`/papers/${session.paperId}/summary?session=${session.id}`);
    } catch {
    } finally {
      setBusy(false);
    }
  }
  async function summary() {
    try {
      await save();
      router.push(`/papers/${session.paperId}/summary?session=${session.id}`);
    } catch {}
  }
  return (
    <>
      <article className="question-card">
        <div className="question-meta">
          <strong>Question {q.number}</strong>
          <span>
            {q.marks !== null
              ? `${q.marks} ${q.marks === 1 ? "mark" : "marks"}`
              : ""}
            {q.kind === "multi_select" ? " · Select all that apply" : ""}
          </span>
        </div>
        {q.context.length > 0 && (
          <div className="question-context">
            <RichContent blocks={q.context} />
          </div>
        )}
        <RichContent blocks={q.prompt} />
        {q.excluded && (
          <div className="notice">
            This question is excluded from your progress score. Its original
            content is still available here.
          </div>
        )}
        {q.kind.includes("select") ? (
          <div className="options" role="group" aria-label="Answer options">
            {q.options.map((option) => (
              <label className="option" key={option.id}>
                <input
                  type={q.kind === "multi_select" ? "checkbox" : "radio"}
                  name={`question-${q.id}`}
                  aria-label={`${option.id} ${option.content
                    .filter((b) => b.kind === "markdown")
                    .map((b) => b.text)
                    .join(" ")}`}
                  checked={
                    response.kind === "selection" &&
                    response.optionIds.includes(option.id)
                  }
                  disabled={!!shownAttempt || busy}
                  onChange={() => {
                    const selected =
                      response.kind === "selection" ? response.optionIds : [];
                    change({
                      kind: "selection",
                      optionIds:
                        q.kind === "multi_select"
                          ? selected.includes(option.id)
                            ? selected.filter((id) => id !== option.id)
                            : [...selected, option.id]
                          : [option.id],
                    });
                  }}
                />
                <span className="option-letter" aria-hidden="true">
                  {option.id}
                </span>
                <RichContent blocks={option.content} />
              </label>
            ))}
          </div>
        ) : q.kind === "written" ? (
          <label>
            Your answer
            <textarea
              value={response.kind === "written" ? response.text : ""}
              disabled={!!shownAttempt || busy}
              onChange={(e) =>
                change({ kind: "written", text: e.target.value })
              }
              placeholder="Type your answer and working here…"
              maxLength={30000}
            />
          </label>
        ) : (
          <div className="notice">
            This question needs a drawn or unsupported response. You can skip it
            without affecting your correctness.
          </div>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="player-actions">
          <div className="inline-actions">
            {!shownAttempt && q.kind !== "unsupported" && (
              <button
                className="button primary"
                disabled={busy || !hasResponse}
                onClick={() => void submit()}
              >
                {busy ? "Saving…" : "Submit answer"}
                <Send size={13} />
              </button>
            )}
            {shownAttempt && (
              <button
                className="button small"
                onClick={() => {
                  setReattempt(true);
                  requestId.current = crypto.randomUUID();
                }}
              >
                <RotateCcw size={12} />
                Try again
              </button>
            )}
            <span className="autosave" role="status">
              {saveStatus}
            </span>
          </div>
          <div className="inline-actions">
            <button
              className="button ghost small"
              disabled={busy}
              onClick={() => void skip(false)}
            >
              Skip for now
            </button>
            <button
              className="button ghost small"
              disabled={busy}
              onClick={() => void skip(true)}
            >
              Skip: requires drawing
            </button>
          </div>
        </div>
        {q.source.length > 0 && (
          <div className="source-previews">
            {q.source.map((source, i) => (
              <a
                key={i}
                className="source-link"
                href={`/api/documents/${source.documentId}/source#page=${source.page}`}
                target="_blank"
                rel="noreferrer"
              >
                Original question · p. {source.page}
                <ExternalLink size={10} />
              </a>
            ))}
          </div>
        )}
      </article>
      {shownAttempt && (
        <FeedbackPanel attempt={shownAttempt} onRefresh={onRefresh} />
      )}
      <div className="question-footer">
        <button
          className="button"
          disabled={busy || position === 0}
          onClick={() => void navigate(position - 1)}
        >
          <ArrowLeft size={13} />
          Previous
        </button>
        <div className="inline-actions">
          {session.progress.state === "completed" ||
          position === session.questions.length - 1 ? (
            <button
              className="button primary"
              disabled={busy}
              onClick={() => void summary()}
            >
              View summary
              <ArrowRight size={13} />
            </button>
          ) : (
            <button
              className="button primary"
              disabled={busy}
              onClick={() => void navigate(position + 1)}
            >
              Next question
              <ArrowRight size={13} />
            </button>
          )}
        </div>
      </div>
    </>
  );
}
function FeedbackPanel({
  attempt,
  onRefresh,
}: {
  attempt: AttemptView;
  onRefresh: () => Promise<unknown>;
}) {
  const [error, setError] = useState("");
  const f = attempt.feedback;
  const [assessing, setAssessing] = useState(false);
  async function assess() {
    setAssessing(true);
    setError("");
    try {
      await post(`/api/attempts/${attempt.id}/assess`);
      await onRefresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAssessing(false);
    }
  }
  async function retry() {
    try {
      if (attempt.job) await post(`/api/jobs/${attempt.job.id}/retry`);
      await onRefresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (!f)
    return (
      <section className="feedback">
        <h2>
          {attempt.status === "failed"
            ? "Your answer is saved. Feedback needs a retry."
            : "Working through your answer…"}
        </h2>
        <p className="notice">
          {attempt.job?.errorMessage ||
            "You can stay here or return later. Your submitted answer is saved."}
        </p>
        {attempt.status === "failed" && (
          <button className="button" onClick={() => void retry()}>
            Retry feedback
          </button>
        )}
        {error && <p className="error">{error}</p>}
      </section>
    );
  const labels = {
    correct: "Correct",
    incorrect: "Incorrect",
    partly_correct: "Partly correct",
    unable_to_assess: "Unable to assess",
  };
  return (
    <section className={`feedback ${f.verdict}`}>
      <div className="feedback-title">
        {f.verdict === "correct" ? (
          <CheckCircle2 size={21} />
        ) : (
          <AlertCircle size={21} />
        )}
        <h2>
          {f.assessmentMode === "self_review"
            ? "Compare your answer"
            : labels[f.verdict]}
        </h2>
        {f.provisional && (
          <span className="provisional">
            {f.assessmentMode === "self_review"
              ? "Self-review"
              : "Provisional assessment"}
          </span>
        )}
      </div>
      {f.assessmentMode === "self_review" && (
        <div className="self-review-notice">
          <p>
            Your answer has not been graded. Compare it with the worked
            explanation and reference below.
          </p>
          <button
            className="button small"
            disabled={assessing || attempt.status === "pending"}
            onClick={() => void assess()}
          >
            {attempt.status === "pending"
              ? "AI assessment in progress…"
              : "Assess with AI (optional)"}
          </button>
          {attempt.job?.errorMessage && (
            <p className="notice">
              {attempt.job.errorMessage} Your reference remains available.
            </p>
          )}
        </div>
      )}
      {f.score && (
        <p className="muted" style={{ fontSize: 11 }}>
          {f.score.earned} / {f.score.possible} marks
          {f.provisional ? " · AI-assessed" : ""}
        </p>
      )}
      {f.strengths.length > 0 && (
        <ul>
          {f.strengths.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      )}
      {f.issues.length > 0 && (
        <>
          <div className="feedback-label">WHAT TO WATCH FOR</div>
          <ul>
            {f.issues.map((issue, i) => (
              <li key={i}>
                {issue.evidence && <q>{issue.evidence}</q>} {issue.explanation}
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="feedback-label">
        THE EXPLANATION{" "}
        <span>
          ·{" "}
          {f.explanationOrigin === "imported"
            ? "Supplied in JSON"
            : "AI-generated"}
        </span>
      </div>
      {f.explanationNeedsReview && (
        <p className="muted">
          This AI explanation needs checking. Compare it with the reference
          answer below.
        </p>
      )}
      <div data-testid="feedback-explanation">
        <RichContent blocks={f.worked} attemptId={attempt.id} />
      </div>
      <div className="reference">
        <div className="feedback-label">
          REFERENCE ANSWER ·{" "}
          {f.reference.origin === "official"
            ? "OFFICIAL / COURSE-PROVIDED"
            : "AI-GENERATED, UNVERIFIED"}
        </div>
        <RichContent blocks={f.reference.content} attemptId={attempt.id} />
        {f.reference.source.map((s, i) => (
          <a
            key={i}
            className="source-link"
            target="_blank"
            rel="noreferrer"
            href={`/api/documents/${s.documentId}/source?mode=attempt&attemptId=${attempt.id}#page=${s.page}`}
          >
            Original solution · p. {s.page}
            <ExternalLink size={10} />
          </a>
        ))}
      </div>
      <Followup attemptId={attempt.id} />
      <button
        className="button ghost small"
        disabled={attempt.disputed}
        onClick={async () => {
          try {
            await api(`/api/attempts/${attempt.id}`, {
              method: "PATCH",
              body: JSON.stringify({ disputed: true }),
            });
            await onRefresh();
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        {attempt.disputed
          ? "Flagged for review"
          : "Flag this feedback for review"}
      </button>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
function Followup({ attemptId }: { attemptId: string }) {
  const { data: messages, reload } = useApi<ChatMessage[]>(
      `/api/attempts/${attemptId}/messages`,
      2500,
    ),
    [text, setText] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function ask(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await post(`/api/attempts/${attemptId}/messages`, {
        text,
        requestId: crypto.randomUUID(),
      });
      setText("");
      await reload();
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="followup">
      <summary>
        <MessageCircle
          size={12}
          style={{ verticalAlign: "middle", marginRight: 5 }}
        />
        Question this feedback
      </summary>
      <p className="notice">
        Optional AI chat uses the app’s configured provider.
      </p>
      {messages?.map((m) => (
        <div key={m.id} className={`chat-message ${m.role}`}>
          <small>
            {m.role === "user" ? "YOU" : "AI EXPLANATION"}
            {m.status === "pending"
              ? " · Waiting for a reply"
              : m.status === "failed"
                ? " · Reply failed — you can ask again"
                : ""}
          </small>
          <RichContent blocks={[{ kind: "markdown", text: m.text }]} />
        </div>
      ))}
      <form className="chat-compose" onSubmit={ask}>
        <label>
          Ask about this question
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Why is this step needed?"
            maxLength={4000}
          />
        </label>
        <button className="button" disabled={busy || !text.trim()}>
          <Send size={13} />
          Ask
        </button>
      </form>
      {error && <p className="error">{error}</p>}
    </details>
  );
}
export function Summary({
  paperId,
  sessionId,
}: {
  paperId: string;
  sessionId?: string;
}) {
  const [resolved, setResolved] = useState(sessionId || "");
  useEffect(() => {
    if (!resolved)
      post<SessionView>(`/api/papers/${paperId}/sessions`).then((s) =>
        setResolved(s.id),
      );
  }, [resolved, paperId]);
  const { data: s, error } = useApi<ReturnType<typeof getSummary>>(
    resolved ? `/api/sessions/${resolved}/summary` : null,
  );
  if (!s)
    return (
      <p className={error ? "error" : "loading"}>
        {error || "Loading your progress…"}
      </p>
    );
  const correct = s.results.filter((r) => r.verdict === "correct").length,
    provisional = s.results.filter(
      (r) => r.provisional && r.assessmentMode !== "self_review",
    ).length,
    selfReviews = s.results.filter(
      (r) => r.assessmentMode === "self_review",
    ).length;
  return (
    <>
      <div className="breadcrumb">
        <Link href={`/modules/${s.moduleId}`}>Module</Link>
        <ChevronRight size={12} />
        <span>{s.title}</span>
      </div>
      <section className="summary-panel">
        <CheckCircle2 size={45} />
        <h1>
          {s.progress.state === "completed"
            ? "Paper completed"
            : s.progress.included === 0
              ? "No supported questions"
              : "Every question is a step forward."}
        </h1>
        <p>
          {s.title} · {s.progress.submitted} of {s.progress.included} included
          questions answered
        </p>
        <Link className="button primary" href={`/modules/${s.moduleId}`}>
          Back to module
          <ArrowRight size={14} />
        </Link>
        <Link className="button ghost" href={`/papers/${paperId}/practice`}>
          Revisit questions
        </Link>
      </section>
      <div className="summary-grid">
        <div className="summary-item">
          <strong>{s.progress.submitted}</strong>
          <span>Questions answered</span>
        </div>
        <div className="summary-item">
          <strong>{correct}</strong>
          <span>Correct against reference</span>
        </div>
        <div className="summary-item">
          <strong>{provisional}</strong>
          <span>Provisional assessments</span>
        </div>
      </div>
      {selfReviews > 0 && (
        <p className="notice">
          {selfReviews} written response(s) are available for self-review and
          have not been graded.
        </p>
      )}
      {s.excluded.length > 0 && (
        <p className="notice">
          Excluded from scoring: {s.excluded.join(", ")}. Drawing or unsupported
          questions never count as incorrect.
        </p>
      )}
      {s.skipped.length > 0 && (
        <p className="notice">
          Still to answer: {s.skipped.join(", ")}. Skips stay incomplete until
          you answer or exclude them.
        </p>
      )}
      <div className="papers-table">
        {s.results.map((r) => (
          <div className="paper-row" key={r.attemptId}>
            <strong style={{ fontSize: 12 }}>Question {r.number}</strong>
            <span className="muted" style={{ fontSize: 11 }}>
              {r.assessmentMode === "self_review"
                ? "self-review"
                : r.verdict.replaceAll("_", " ")}
            </span>
            <span className="muted" style={{ fontSize: 10 }}>
              {r.assessmentMode === "self_review"
                ? "Not graded"
                : r.provisional
                  ? "Provisional"
                  : "Official key"}
            </span>
            <Link className="source-link" href={`/papers/${paperId}/practice`}>
              Revisit
              <ArrowRight size={12} />
            </Link>
          </div>
        ))}
      </div>
    </>
  );
}
