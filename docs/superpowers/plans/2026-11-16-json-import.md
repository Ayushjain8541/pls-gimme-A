# JSON-first paper import implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement inline, preserving the user's existing execution preference.

**Goal:** Students can create ready practice papers from externally prepared JSON with copyable conversion/repair prompts and no required model calls.
**Architecture:** Portable Zod contract maps to existing revision snapshots. A dedicated import service validates source ownership and PDF page references, then atomically publishes. A module dialog promotes JSON imports while keeping optional AI PDF conversion. Written imports use self-review with explicit AI opt-in.
**Tech Stack:** Existing Next.js, React, TypeScript, Zod, SQLite and PyMuPDF.
**Spec:** docs/superpowers/specs/2026-11-16-json-import-design.md

## Global constraints

- Inline execution; small commits and batched pushes.
- No model calls for JSON import or default imported practice.
- Preserve previous sessions, private files, source/answer separation and local-origin checks.
- 4 MiB JSON / 500 questions; existing PDF limits unchanged.

## Review focus

- Invalid syntax, unknown keys, duplicate leaves and incomplete MCQ explanations: precise repair report, no partial paper.
- Missing, cross-module or out-of-range PDFs: actionable errors and no answer assets before submission.
- Repeated import/double-click: same paper returned without duplicate jobs.
- API-key-free written practice: explicit self-review, never falsely graded correct or marked with fabricated scores.
- External answer origin and imported Markdown: provisional labels and inert unsafe content.

### Task 1: Portable contract and prompts
- [ ] Add failing contract tests covering exact subparts, invalid structure/options/explanations and repair prompts.
- [ ] Implement schema, semantic validation, example, generated JSON schema and conversion/repair prompt.
- [ ] Verify focused tests and commit.

### Task 2: Import service and routes
- [ ] Add integration failures for import-without-AI, malformed input/no mutations, deduplication, PDF refs/ownership and source separation.
- [ ] Add private JSON document storage, import provenance/dedup table, validation/import routes and format downloads.
- [ ] Map portable blocks to existing assets/revisions and atomically publish without jobs; reject AI reconversion of JSON-only originals.
- [ ] Verify focused tests and commit.

### Task 3: Practice and import UI
- [ ] Add written self-review and explicit AI opt-in with integration tests.
- [ ] Add module primary import action, prompt/example/schema downloads, JSON file/paste selection, optional PDFs, validation summary and copyable repair prompt.
- [ ] Add browser workflows for invalid→repair→valid import, default no-AI practice, origin labels and original AI PDF path.
- [ ] Verify checks and commit.

### Task 4: Verify and ship
- [ ] Full tests, lint, typecheck, browser workflows and production build.
- [ ] One independent focused review; fix confirmed important findings with regression coverage.
- [ ] Update README and implementation notes; rebuild/restart app and worker, read-only production smoke check.
- [ ] Commit and push in a batch; report behavior and verification limits.
