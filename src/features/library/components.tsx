"use client";
import Link from "next/link";
import { useState } from "react";
import {
  Plus,
  Folder,
  ArrowUpRight,
  BookOpen,
  Files,
  Target,
  X,
  ArrowRight,
} from "lucide-react";
import { useApi, post } from "@/components/api";
import type { Module } from "./service";
export function Library() {
  const { data: modules, error, reload } = useApi<Module[]>("/api/modules");
  const [show, setShow] = useState(false),
    [code, setCode] = useState(""),
    [title, setTitle] = useState(""),
    [formError, setFormError] = useState(""),
    [busy, setBusy] = useState(false);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await post("/api/modules", { code, title });
      await reload();
      setShow(false);
      setCode("");
      setTitle("");
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="eyebrow">
        <span className="tiny-line" />A LITTLE PROGRESS, EVERY DAY
      </div>
      <div className="page-heading">
        <div>
          <h1>Your next A starts here.</h1>
          <p>All your papers. A clearer way to practise.</p>
        </div>
        <button className="button primary" onClick={() => setShow(true)}>
          <Plus size={17} />
          New module
        </button>
      </div>
      <section className="welcome-panel">
        <div className="welcome-copy">
          <span className="pill">
            <SparkIcon />
            FOCUSED PRACTICE
          </span>
          <h2>
            Less paper shuffling.
            <br />
            More lightbulb moments.
          </h2>
          <p>
            Turn your past papers into one question at a time.
            <br />
            Answer, understand, and keep moving forward.
          </p>
          <div className="welcome-steps">
            <span>
              <i>1</i>Upload your papers
            </span>
            <ArrowRight size={13} />
            <span>
              <i>2</i>Practise & understand
            </span>
            <ArrowRight size={13} />
            <span>
              <i>3</i>See your progress
            </span>
          </div>
        </div>
        <div className="paper-art" aria-hidden="true">
          <div className="art-sheet back" />
          <div className="art-sheet front">
            <div className="art-top">
              <span />
              <span>QUESTION 01</span>
            </div>
            <div className="art-line long" />
            <div className="art-line" />
            <div className="art-answer">
              <span>A</span>
              <div />
            </div>
            <div className="art-answer selected">
              <span>B</span>
              <div />
              <b>✓</b>
            </div>
            <div className="art-answer">
              <span>C</span>
              <div />
            </div>
          </div>
          <div className="art-label">
            <span>✦</span>One question closer.
          </div>
        </div>
      </section>
      <div className="section-heading">
        <div>
          <h2>
            My modules <span className="count">{modules?.length || 0}</span>
          </h2>
          <p>A home for every subject you’re working on.</p>
        </div>
        <span className="subtle-label">YOUR LIBRARY</span>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="module-grid">
        {modules?.map((m, i) => (
          <Link
            className={`module-card color-${i % 4}`}
            key={m.id}
            href={`/modules/${m.id}`}
          >
            <div className="module-card-top">
              <span className="folder-tile">
                <Folder size={26} />
              </span>
              <ArrowUpRight size={19} />
            </div>
            <h3>{m.code}</h3>
            <p>{m.title}</p>
            <div className="module-card-bottom">
              <span>Open module</span>
              <ArrowRight size={16} />
            </div>
          </Link>
        ))}
        <button className="add-module-card" onClick={() => setShow(true)}>
          <span>
            <Plus size={24} />
          </span>
          <strong>
            {modules?.length
              ? "Add another module"
              : "Create your first module"}
          </strong>
          <p>Give your papers a home.</p>
        </button>
      </div>
      <div className="library-bottom">
        <div>
          <BookOpen size={19} />
          <span>
            <strong>Your papers, organized</strong>
            <small>Keep every module in its own space.</small>
          </span>
        </div>
        <div>
          <Target size={19} />
          <span>
            <strong>Understand every answer</strong>
            <small>Full explanations, right when you need them.</small>
          </span>
        </div>
        <div>
          <Files size={19} />
          <span>
            <strong>Pick up where you left off</strong>
            <small>Your attempts and progress stay saved.</small>
          </span>
        </div>
      </div>
      {show && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-module-title"
          >
            <button
              className="icon-button close"
              aria-label="Close"
              onClick={() => setShow(false)}
            >
              <X size={20} />
            </button>
            <span className="folder-tile color-0">
              <Folder size={25} />
            </span>
            <h2 id="new-module-title">A new space to practise.</h2>
            <p>Create a module folder for its past papers.</p>
            <form onSubmit={create}>
              <label>
                Module code
                <input
                  autoFocus
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="CS2100"
                  maxLength={30}
                />
              </label>
              <label>
                Module name
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Computer Organisation"
                  maxLength={120}
                />
              </label>
              {formError && (
                <p className="error" role="alert">
                  {formError}
                </p>
              )}
              <button className="button primary wide" disabled={busy}>
                {busy ? "Creating…" : "Create module"}
                <ArrowRight size={16} />
              </button>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
function SparkIcon() {
  return <span>✦</span>;
}
