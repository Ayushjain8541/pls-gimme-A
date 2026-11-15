# Implementation notes — 15 November 2026

The app is implemented on `codex/exam-practice-mvp` and pushed in batches to the supplied GitHub repository. It supports module folders, paired batch upload, background conversion, automatic readiness, exceptional repair, one-question practice, full immediate feedback, typed written assessment, saved drafts/attempts, exclusions, progress, summaries, and question-scoped follow-up.

## Verification

- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test`: 29 tests passed across 18 files.
- `npm run test:e2e`: 6 browser workflows passed, including a 10 question PDF + 10 solution PDF batch, automatic readiness, answer reveal after submission, MCQ and written feedback, follow-up, refresh/resume, completion, missing solutions and generated-answer labels, repair, inert HTML, mobile layout, clearing drafts, and cross-tab synchronization.
- Production build and startup checked; production library rendered with no browser page errors or horizontal overflow.
- The actual OpenAI SDK accepts the structured-output schemas. Tests replace external model responses; no live API quality claim is implied.

## Independent review and fixes

A fresh reviewer identified four Important issues and no Critical issues. All four were addressed in one fix pass, with reproductions/regressions:

1. A clean second tab now receives the updated answer and its optimistic-lock version together. Unsaved local edits keep their old version and remain protected by server conflict checks.
2. Overlapping question fragments retain shared context, figures, parent instructions, options, marks and page references. Incompatible overlap is flagged for repair.
3. Solution continuations retain later reasoning, keys and source pages; repeated prefixes are deduplicated and conflicting keys/rubrics are flagged.
4. Referenced figures are resolved from private storage and supplied as bounded image inputs during explanation, written assessment and follow-up. Model configuration must support images as well as structured outputs.

A real five-page synthetic PDF pipeline test verifies that page-five figures and completed solution steps survive conversion. Additional regressions fixed cleared drafts, blank reference answers, expired worker commits, stale repair failures, and strict provider-schema compatibility.

## Implementation decisions

These are the executor's decisions, in order, rather than additional user requirements:

1. Work on the `codex/` feature branch in the existing approved workspace. This preserves the requested location and leaves local `main` untouched; there is no second directory providing filesystem isolation.
2. Pass database connections explicitly into services. This makes transaction ownership and isolated tests clear; callers differ from the plan's implicit-global signature examples.
3. Store validated question/answer/explanation snapshots together in immutable revision JSON. Publishing is atomic and old sessions retain their content. Large cross-paper analytics may need normalized content tables later.
4. Use parameterized SQLite repositories and an SQL migration instead of Drizzle query builders. There is no ORM schema generation; adopting one later would require a mapping layer.
5. Verify the interdependent backend first, then assemble and verify the browser workflows. This delayed browser feedback until the services existed; the final integrated checks passed.
6. Use plain CSS for the custom interface instead of Tailwind. Future utility-framework adoption would require style migration.
7. Use a schema-generic AI gateway with distinct named operations, schemas and prompts instead of duplicating five provider methods. Future providers must support the structured gateway contract.
8. Consolidate browser cases into `full-practice.spec.ts` and `preparation.spec.ts`. The checks exercise the real app and worker; only the external AI provider is substituted.

## Review boundaries and remaining inputs

The review set aside three areas, and the executor retained those boundaries:

- Live extraction and grading quality on actual course papers is unverified because no representative course paper/key or API configuration was supplied. The cost is that real-paper formatting and model-quality defects can still surface. Use the real-paper checklist before relying on assessment quality.
- A local owner can deliberately open answer-visible repair routes. The app prevents accidental answer disclosure in practice, rather than trying to prevent its owner from inspecting their own files.
- Public multi-user deployment and automatic generation of missing reference solutions remain deferred as designed. This build is a personal local app and requires supplied official or externally generated reference solutions.

Before using AI, edit the ignored `.env.local` with an API key and three accessible image-capable structured-output model IDs, then restart the app and worker. The library can be used before configuration. No secrets or original student/course documents are committed.
