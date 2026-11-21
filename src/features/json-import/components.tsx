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
    [exporting, setExporting] = useState<"question" | "solution" | null>(null),
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
  async function uploaded(role: "question" | "solution", file: File) {
    const key = role + fileKey(file);
    let id = docs.current.get(key);
    if (!id) {
      id = (await uploadFile(moduleId, file, role)).id;
      docs.current.set(key, id);
    }
    return id;
  }
  async function downloadSource(role: "question" | "solution") {
    const file = role === "question" ? question : solution;
    if (!file) return;
    setBusy(true);
    setExporting(role);
    setError("");
    try {
      const documentId = await uploaded(role, file);
      const response = await fetch(`/api/modules/${moduleId}/source-markdown`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(
          data.error?.message || "Could not extract the source text.",
        );
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = file.name.replace(/\.pdf$/i, "") + "-source.md";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(null);
      setBusy(false);
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
      result[`${role}DocumentId`] = await uploaded(role, file);
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
          Import your prepared JSON, with source PDFs if it uses page images. No
          API key is needed.
        </p>
        <h3>1. Get the conversion prompt</h3>
        <p className="muted">
          Need a JSON file? Use this prompt in your own AI chat with the exam
          PDFs. It preserves diagrams as PDF images; attach the same PDFs below
          when importing. Source Markdown below helps copy original wording.
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
        <section aria-labelledby="json-source-pdfs-title">
          <h3 id="json-source-pdfs-title">Source PDFs (optional)</h3>
          <p className="muted">
            Choose PDFs here to download source text for your AI chat, even
            before you have JSON. Required for any PDF images referenced in your
            JSON; page citations alone do not display diagrams. No AI calls.
          </p>
          <div className="upload-grid">
            <div>
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
              <button
                className="button small"
                disabled={busy || !question}
                onClick={() => void downloadSource("question")}
              >
                <Download size={13} />
                {exporting === "question"
                  ? "Preparing source…"
                  : "Download question Markdown"}
              </button>
            </div>
            <div>
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
              <button
                className="button small"
                disabled={busy || !solution}
                onClick={() => void downloadSource("solution")}
              >
                <Download size={13} />
                {exporting === "solution"
                  ? "Preparing source…"
                  : "Download answer Markdown"}
              </button>
            </div>
          </div>
        </section>
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
