"use client";
import { useEffect, useId, useRef, useState, type DragEvent } from "react";
import { Upload, FileText, X, ExternalLink } from "lucide-react";
import { fileKey, mergeFiles, type UploadRole } from "./file-selection";
export function FilePicker({
  role,
  label,
  files,
  onChange,
  disabled = false,
  capacity = 40,
}: {
  role: UploadRole;
  label: string;
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
  capacity?: number;
}) {
  const input = useRef<HTMLInputElement>(null),
    depth = useRef(0),
    helpId = useId();
  const [dragging, setDragging] = useState(false),
    [error, setError] = useState(""),
    [announcement, setAnnouncement] = useState("");
  function add(incoming: File[]) {
    if (disabled || !incoming.length) return;
    const result = mergeFiles(files, incoming, role, capacity);
    onChange(result.files);
    setError(result.errors.join("\n"));
    setAnnouncement(
      `${result.files.length} file${result.files.length === 1 ? "" : "s"} selected.${result.duplicates ? " Already selected files were skipped." : ""}`,
    );
  }
  function dragEnter(event: DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    if (!disabled) {
      depth.current++;
      setDragging(true);
    }
  }
  function dragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    depth.current = Math.max(0, depth.current - 1);
    if (!depth.current) setDragging(false);
  }
  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    depth.current = 0;
    setDragging(false);
    add(Array.from(event.dataTransfer.files));
  }
  return (
    <div
      className={`file-drop${dragging && !disabled ? " drag-over" : ""}`}
      role="group"
      aria-label={
        role === "question" ? "Paper drop zone" : "Solution drop zone"
      }
      aria-disabled={disabled}
      onDragEnter={dragEnter}
      onDragLeave={dragLeave}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = disabled ? "none" : "copy";
      }}
      onDrop={drop}
    >
      {role === "question" ? <Upload size={24} /> : <FileText size={24} />}
      <strong className="file-picker-heading">{label}</strong>
      <input
        ref={input}
        className="file-picker-input"
        type="file"
        aria-label={label}
        aria-describedby={helpId}
        multiple
        disabled={disabled}
        accept={role === "question" ? ".pdf" : ".pdf,.md,.txt,.markdown"}
        onChange={(event) => {
          add(Array.from(event.currentTarget.files || []));
          event.currentTarget.value = "";
        }}
      />
      <button
        type="button"
        className="button small"
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        Choose files
      </button>
      <p className="file-drop-hint">or drag and drop here</p>
      <p id={helpId}>
        {role === "question"
          ? "PDF · Up to 25 MiB each"
          : "PDF, Markdown, or text · Optional"}
      </p>
      <p className="file-selection-count" role="status" aria-live="polite">
        {announcement || `${files.length} files selected`}
      </p>
      {files.length > 0 && (
        <ul
          className="selected-files"
          aria-label={
            role === "question"
              ? "Selected question papers"
              : "Selected solution files"
          }
        >
          {files.map((file) => (
            <SelectedFile
              key={fileKey(file)}
              file={file}
              disabled={disabled}
              onRemove={() => {
                onChange(
                  files.filter((item) => fileKey(item) !== fileKey(file)),
                );
                setError("");
                setAnnouncement(
                  `${files.length - 1} file${files.length - 1 === 1 ? "" : "s"} selected.`,
                );
              }}
            />
          ))}
        </ul>
      )}
      {error && (
        <p className="error file-selection-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
function SelectedFile({
  file,
  disabled,
  onRemove,
}: {
  file: File;
  disabled: boolean;
  onRemove: () => void;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const type = /\.pdf$/i.test(file.name)
      ? "application/pdf"
      : "text/plain;charset=utf-8";
    const objectUrl = URL.createObjectURL(new Blob([file], { type }));
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  const size =
    file.size >= 1024 * 1024
      ? `${(file.size / (1024 * 1024)).toFixed(1)} MB`
      : `${Math.max(1, Math.ceil(file.size / 1024))} KB`;
  return (
    <li className="selected-file">
      <FileText size={15} />
      <div className="selected-file-details">
        <a
          href={url || undefined}
          aria-label={`Preview ${file.name}`}
          target="_blank"
          rel="noreferrer"
          title={file.name}
        >
          {file.name}
          <ExternalLink size={10} />
        </a>
        <small>{size}</small>
      </div>
      <button
        type="button"
        className="icon-button"
        aria-label={`Remove ${file.name}`}
        disabled={disabled}
        onClick={onRemove}
      >
        <X size={15} />
      </button>
    </li>
  );
}
