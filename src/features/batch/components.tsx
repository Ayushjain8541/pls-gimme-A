"use client";
import { useState, useRef } from "react";
import { X, Upload, FileText, ArrowRight, Check } from "lucide-react";
import { post } from "@/components/api";
import type { DocumentMeta } from "@/features/documents/service";
import type { PairingProposal } from "./service";
export function uploadFile(
  moduleId: string,
  file: File,
  role: "question" | "solution",
  progress?: (value: number) => void,
): Promise<DocumentMeta> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/modules/${moduleId}/documents?role=${role}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable)
        progress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () => reject(new Error("Upload interrupted. Please retry."));
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 400)
          reject(new Error(data.error?.message || "Upload failed."));
        else resolve(data);
      } catch {
        reject(new Error("Upload failed. Check that the app is running."));
      }
    };
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}
export function BatchUpload({
  moduleId,
  onClose,
  onComplete,
}: {
  moduleId: string;
  onClose: () => void;
  onComplete: () => void;
}) {
  const [questions, setQuestions] = useState<File[]>([]),
    [solutions, setSolutions] = useState<File[]>([]),
    [docs, setDocs] = useState<DocumentMeta[]>([]),
    [pairs, setPairs] = useState<
      | (PairingProposal & { solutionOrigin: "official" | "external_ai" })[]
      | null
    >(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [progress, setProgress] = useState("");
  const uploaded = useRef(new Map<string, DocumentMeta>()),
    requestId = useRef(crypto.randomUUID());
  async function prepare() {
    setBusy(true);
    setError("");
    try {
      if (!questions.length)
        throw new Error("Choose at least one question paper.");
      if (questions.length + solutions.length > 40)
        throw new Error("Choose up to 40 files in one upload.");
      const results: DocumentMeta[] = [];
      for (const [role, files] of [
        ["question", questions],
        ["solution", solutions],
      ] as const) {
        for (const file of files) {
          const key = `${role}:${file.name}:${file.size}:${file.lastModified}`;
          let doc = uploaded.current.get(key);
          if (!doc) {
            doc = await uploadFile(moduleId, file, role, (pct) =>
              setProgress(`Uploading ${file.name} · ${pct}%`),
            );
            uploaded.current.set(key, doc);
          }
          results.push(doc);
        }
      }
      setDocs(results);
      setProgress("Matching your files…");
      const proposals = await post<PairingProposal[]>(
        `/api/modules/${moduleId}/batch/preview`,
        { documentIds: results.map((d) => d.id) },
      );
      setPairs(proposals.map((p) => ({ ...p, solutionOrigin: "official" })));
      setProgress("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    if (!pairs) return;
    setBusy(true);
    setError("");
    try {
      await post(`/api/modules/${moduleId}/batch/confirm`, {
        requestId: requestId.current,
        pairs,
      });
      onComplete();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop">
      <section
        className="modal large"
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-title"
      >
        <button
          className="icon-button close"
          aria-label="Close upload"
          disabled={busy}
          onClick={onClose}
        >
          <X size={20} />
        </button>
        <span className="folder-tile">
          <Upload size={24} />
        </span>
        <h2 id="upload-title">
          {pairs
            ? "A quick check, then you’re set."
            : "Bring your papers together."}
        </h2>
        <p>
          {pairs
            ? "Confirm which solutions belong to each paper. We’ll take care of the preparation."
            : "Upload question papers and any solution files. They’ll stay in this module."}
        </p>
        {!pairs ? (
          <>
            <div className="upload-grid">
              <div className="file-drop">
                <Upload size={24} />
                <label>
                  Question papers
                  <input
                    aria-label="Question papers"
                    type="file"
                    multiple
                    accept=".pdf"
                    onChange={(e) =>
                      setQuestions(Array.from(e.target.files || []))
                    }
                  />
                </label>
                <p>PDF · Up to 25 MiB each</p>
                <p>{questions.length ? `${questions.length} selected` : ""}</p>
              </div>
              <div className="file-drop">
                <FileText size={24} />
                <label>
                  Solution files
                  <input
                    aria-label="Solution files"
                    type="file"
                    multiple
                    accept=".pdf,.md,.txt,.markdown"
                    onChange={(e) =>
                      setSolutions(Array.from(e.target.files || []))
                    }
                  />
                </label>
                <p>PDF, Markdown, or text · Optional</p>
                <p>{solutions.length ? `${solutions.length} selected` : ""}</p>
              </div>
            </div>
            <div className="notice">
              Missing some solutions? You can add those papers now and attach
              solutions later.
            </div>
          </>
        ) : (
          <div>
            {pairs.map((pair, i) => (
              <div className="pair-row" key={pair.questionDocumentId}>
                <label>
                  Paper title
                  <input
                    value={pair.title}
                    onChange={(e) =>
                      setPairs(
                        pairs.map((p, j) =>
                          j === i ? { ...p, title: e.target.value } : p,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  Matching solutions
                  <select
                    value={pair.solutionDocumentId || ""}
                    onChange={(e) =>
                      setPairs(
                        pairs.map((p, j) =>
                          j === i
                            ? {
                                ...p,
                                solutionDocumentId: e.target.value || null,
                              }
                            : p,
                        ),
                      )
                    }
                  >
                    <option value="">Add solutions later</option>
                    {docs
                      .filter((d) => d.role === "solution")
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.originalName}
                        </option>
                      ))}
                  </select>
                </label>
                {pair.solutionDocumentId && (
                  <label className="origin-label">
                    Solution origin
                    <select
                      value={pair.solutionOrigin}
                      onChange={(e) =>
                        setPairs(
                          pairs.map((p, j) =>
                            j === i
                              ? {
                                  ...p,
                                  solutionOrigin: e.target.value as
                                    "official" | "external_ai",
                                }
                              : p,
                          ),
                        )
                      }
                    >
                      <option value="official">
                        Official / provided by course
                      </option>
                      <option value="external_ai">
                        AI-generated externally
                      </option>
                    </select>
                  </label>
                )}
                <small className="muted">{pair.reason}</small>
              </div>
            ))}
          </div>
        )}
        {progress && (
          <p className="upload-progress" role="status">
            {progress}
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          {pairs && (
            <button
              className="button"
              disabled={busy}
              onClick={() => setPairs(null)}
            >
              Back
            </button>
          )}
          <button
            className="button primary"
            disabled={busy}
            onClick={() => void (pairs ? confirm() : prepare())}
          >
            {busy
              ? "Working…"
              : pairs
                ? "Confirm and prepare"
                : "Prepare upload"}
            {pairs ? <Check size={15} /> : <ArrowRight size={15} />}
          </button>
        </div>
      </section>
    </div>
  );
}
