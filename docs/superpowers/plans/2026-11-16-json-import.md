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
- [x] Add failing contract tests covering exact subparts, invalid structure/options/explanations and repair prompts.
- [x] Implement schema, semantic validation, example, generated JSON schema and conversion/repair prompt.
- [x] Verify focused tests and commit.

### Task 2: Import service and routes
- [x] Add integration failures for import-without-AI, malformed input/no mutations, deduplication, PDF refs/ownership and source separation.
- [x] Add private JSON document storage, import provenance/dedup table, validation/import routes and format downloads.
- [x] Map portable blocks to existing assets/revisions and atomically publish without jobs; reject AI reconversion of JSON-only originals.
- [x] Verify focused tests and commit.

### Task 3: Practice and import UI
- [x] Add written self-review and explicit AI opt-in with integration tests.
- [x] Add module primary import action, prompt/example/schema downloads, JSON file/paste selection, optional PDFs, validation summary and copyable repair prompt.
- [x] Add browser workflows for invalid→repair→valid import, default no-AI practice, origin labels and original AI PDF path.
- [x] Verify checks and commit.

### Task 4: Verify and ship
- [x] Full tests, lint, typecheck, browser workflows and production build.
- [x] One independent focused review; fix confirmed important findings with regression coverage.
- [x] Update README and implementation notes; rebuild/restart app and worker, read-only production smoke check.
- [x] Commit and push in a batch; report behavior and verification limits.

## Execution ledger

- Ruling: continue in the existing approved `codex/exam-practice-mvp` workspace rather than move the user's running app or introduce another checkout. Existing commit/push authorization remains in force.
- Task 1 complete: portable version-1 contract, full conversion prompt, strict semantic checks and repair prompt; 10 focused tests passed.
- Task 2 complete: private original JSON storage, additive import-provenance table, PDF source resolution, atomic publication, repeated-import reuse and API routes. Rejected JSON creates no paper/jobs. Three integration workflows passed, including local source ownership and answer-image isolation.
- Task 3 complete: module JSON-first UI, downloads, clipboard repair flow and immediate written self-review with explicit provider opt-in. 67 tests and all 12 browser workflows passed, including the existing AI PDF path. Desktop/mobile screenshots inspected.
- Ruling: diagram references use optional original PDFs and physical page numbers rather than large encoded images or invented asset IDs. This preserves source fidelity while keeping the JSON portable.
- Ruling: imports carry prepared explanations; written responses default to self-review, because grading them automatically would defeat the requested provider-optional workflow. A separate explicit AI action can upgrade the assessment.

- Ruling: JSON is the editing source of truth. Imported papers are read-only in the legacy PDF repair screen; its edit/publish mutation paths reject imports. This avoids stripping supplied explanations or silently retaining explanations for changed questions/keys. Corrections create a new paper through JSON import, preserving previous attempts.
- Final review: one Important legacy-editor integration issue reproduced and fixed with regression coverage; related summary/provenance labels corrected. No other Critical/Important findings.
- Final verification: 68 tests / 27 files, 12 browser workflows, lint, typecheck and build passed. Three existing filesystem tracing warnings remain. Production app/worker restarted after a database backup; format downloads and validation returned HTTP 200, import dialog rendered without page errors, three original papers remain Ready and no smoke-test paper/jobs were created.
