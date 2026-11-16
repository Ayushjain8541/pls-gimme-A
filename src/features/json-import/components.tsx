"use client";
import { useRef, useState } from "react";
import { X, Copy, Check, Download, FileJson, ArrowRight } from "lucide-react";
import { useApi } from "@/components/api";
import { uploadFile } from "@/features/batch/components";
import { fileKey } from "@/features/batch/file-selection";
import {
  MAX_JSON_BYTES,
  validatePaperJson,
  buildRepairPrompt,
  type ImportIssue,
} from "./contract";
type Report = { ok: false; issues: ImportIssue[]; repairPrompt: string };
type Summary = {
  title: string;
  questions: number;
  supported: number;
  excluded: number;
  externalAnswers: number;
};
export function JsonImportDialog({
  moduleId,
  onClose,
  onComplete,
}: {
  moduleId: string;
  onClose: () => void;
  onComplete: () => void;
}) {
  const { data: format, error: formatError } = useApi<{ prompt: string }>(
    "/api/import-format",
  );
  const [text, setText] = useState(""),
    [filename, setFilename] = useState(""),
    [question, setQuestion] = useState<File | null>(null),
    [solution, setSolution] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [report, setReport] = useState<Report | null>(null),
    [summary, setSummary] = useState<Summary | null>(null),
    [copied, setCopied] = useState("");
  const docs = useRef(new Map<string, string>()),
    readVersion = useRef(0);
  function changed() {
    setReport(null);
    setSummary(null);
    setError("");
    setCopied("");
  }
  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
    } catch {
      setError("Select and copy the text in the box below.");
    }
  }
  async function choose(file?: File) {
    const version = ++readVersion.current;
    changed();
    setFilename(file?.name || "");
    setText("");
    if (!file) return;
    if (file.size > MAX_JSON_BYTES) {
      setError("JSON limit is 4 MiB. Use one paper per file.");
      return;
    }
    try {
      const value = await file.text();
      if (version === readVersion.current) setText(value);
    } catch {
      setError("Could not read this JSON file.");
    }
  }
  async function input() {
    const result: {
      text: string;
      questionDocumentId?: string;
      solutionDocumentId?: string;
    } = { text };
    for (const [role, file] of [
      ["question", question],
      ["solution", solution],
    ] as const) {
      if (!file) continue;
      const key = role + fileKey(file);
      let id = docs.current.get(key);
      if (!id) {
        id = (await uploadFile(moduleId, file, role)).id;
        docs.current.set(key, id);
      }
      result[`${role}DocumentId`] = id;
    }
    return result;
  }
  async function send(action: "validate" | "confirm") {
    setError("");
    setReport(null);
    setBusy(true);
    try {
      const local = validatePaperJson(text);
      if (!local.ok) {
        setSummary(null);
        setReport({
          ok: false,
          issues: local.issues,
          repairPrompt: buildRepairPrompt(local.issues),
        });
        return;
      }
      const response = await fetch(
        `/api/modules/${moduleId}/json-import/${action}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(await input()),
        },
      );
      const data = await response.json();
      if (data.ok === false) {
        setSummary(null);
        setReport(data);
        return;
      }
      if (!response.ok)
        throw new Error(
          data.error?.message ||
            "Import failed. Your paper has not been added.",
        );
      if (action === "confirm") onComplete();
      else setSummary(data.summary);
    } catch (e) {
      setSummary(null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop">
      <section
        className="modal large json-import"
        role="dialog"
        aria-modal="true"
        aria-labelledby="json-import-title"
      >
        <button
          className="icon-button close"
          aria-label="Close JSON import"
          disabled={busy}
          onClick={onClose}
        >
          <X size={20} />
        </button>
        <h2 id="json-import-title">
          <FileJson size={23} /> Import a paper from JSON
        </h2>
        <p>
          Use your own ChatGPT to prepare the paper, then bring the JSON here.
          No app API key is needed to import or reveal answers.
        </p>
        <h3>1. Get the conversion prompt</h3>
        <p className="notice">
          Copy the prompt into your AI chat and attach the question PDF and
          answer key. Ask it to return a complete .json file. If it generates
          missing solutions, those answers must be labelled AI-generated.
        </p>
        <div className="import-actions">
          <button
            className="button small"
            disabled={!format}
            onClick={() => void copy(format!.prompt, "conversion")}
          >
            {copied === "conversion" ? <Check size={14} /> : <Copy size={14} />}{" "}
            {copied === "conversion"
              ? "Copied conversion prompt"
              : "Copy conversion prompt"}
          </button>
          <a
            className="button ghost small"
            href="/api/import-format?download=prompt"
            download="gimme-a-prompt.txt"
          >
            <Download size={14} />
            Download prompt
          </a>
          <a
            className="source-link"
            href="/api/import-format?download=example"
            download="gimme-a-example.json"
          >
            Example JSON
          </a>
          <a
            className="source-link"
            href="/api/import-format?download=schema"
            download="gimme-a-schema.json"
          >
            JSON schema
          </a>
        </div>
        <details>
          <summary>Read conversion prompt</summary>
          <textarea
            aria-label="Conversion prompt"
            className="import-prompt"
            readOnly
            value={format?.prompt || ""}
          />
        </details>
        {formatError && <p className="error">{formatError}</p>}
        <h3>2. Add the JSON file</h3>
        <label>
          Paper JSON file
          <input
            type="file"
            accept=".json,application/json"
            disabled={busy}
            onChange={(e) => {
              void choose(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        {filename && <p className="muted">Selected: {filename}</p>}
        <label>
          Or paste paper JSON
          <textarea
            aria-label="Paper JSON"
            className="import-json"
            spellCheck={false}
            disabled={busy}
            value={text}
            onChange={(e) => {
              readVersion.current++;
              changed();
              setFilename("");
              setText(e.target.value);
            }}
            placeholder={
              '{ "formatVersion": 1, "title": "…", "questions": […] }'
            }
          />
        </label>
        <details>
          <summary>
            Attach source PDFs for diagrams and page references (optional)
          </summary>
          <p className="notice">
            The default conversion prompt produces JSON-only content and needs
            no PDFs here. Attach source PDFs only to display actual page-image
            blocks in the optional PDF-backed mode. Page-number citations alone
            do not require files. Reading an attached PDF happens locally,
            without AI.
          </p>
          <label>
            Question PDF (optional)
            <input
              type="file"
              accept=".pdf,application/pdf"
              disabled={busy}
              onChange={(e) => {
                changed();
                setQuestion(e.target.files?.[0] || null);
              }}
            />
          </label>
          <label>
            Answer key PDF (optional)
            <input
              type="file"
              accept=".pdf,application/pdf"
              disabled={busy}
              onChange={(e) => {
                changed();
                setSolution(e.target.files?.[0] || null);
              }}
            />
          </label>
        </details>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {report && (
          <section className="import-report" role="alert">
            <h3>Fix these items, then upload the corrected JSON</h3>
            <ul>
              {report.issues.slice(0, 10).map((issue, i) => (
                <li key={i}>
                  <code>{issue.path}</code>: {issue.message}
                </li>
              ))}
            </ul>
            {report.issues.length > 10 && (
              <details>
                <summary>{report.issues.length - 10} more issues</summary>
                <ul>
                  {report.issues.slice(10).map((issue, i) => (
                    <li key={i}>
                      <code>{issue.path}</code>: {issue.message}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <button
              className="button small"
              onClick={() => void copy(report.repairPrompt, "repair")}
            >
              {copied === "repair" ? <Check size={14} /> : <Copy size={14} />}{" "}
              {copied === "repair"
                ? "Copied repair prompt"
                : "Copy repair prompt"}
            </button>
            <textarea
              className="import-prompt"
              aria-label="Repair prompt"
              readOnly
              value={report.repairPrompt}
            />
            <p className="notice">
              Send this repair prompt with your previous JSON file to your AI
              chat. No paper has been added.
            </p>
          </section>
        )}
        {summary && (
          <section className="import-summary" role="status">
            <h3>Ready to import: {summary.title}</h3>
            <p>
              {summary.questions} questions/subparts · {summary.supported}{" "}
              supported · {summary.excluded} excluded
            </p>
            {summary.externalAnswers > 0 && (
              <p>
                {summary.externalAnswers} AI-generated answer(s) will be
                labelled unverified.
              </p>
            )}
            <p className="notice">
              Validation checks the format, mappings and source pages. It does
              not verify mathematical correctness. MCQs use the supplied key;
              written answers use self-review unless you request AI assessment.
            </p>
          </section>
        )}
        <div className="modal-actions">
          <button
            className="button"
            disabled={busy || !text.trim()}
            onClick={() => void send("validate")}
          >
            {busy ? "Checking…" : "Validate JSON"}
          </button>
          <button
            className="button primary"
            disabled={busy || !summary}
            onClick={() => void send("confirm")}
          >
            Import paper
            <ArrowRight size={14} />
          </button>
        </div>
      </section>
    </div>
  );
}
