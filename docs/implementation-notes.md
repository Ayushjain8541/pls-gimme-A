# Implementation notes — 15 November 2026

The app is implemented on `codex/exam-practice-mvp` and pushed in batches to the supplied GitHub repository. It supports module folders, paired batch upload, background conversion, automatic readiness, exceptional repair, one-question practice, full immediate feedback, typed written assessment, saved drafts/attempts, exclusions, progress, summaries, and question-scoped follow-up.

## Verification

- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test`: 34 tests passed across 19 files.
- `npm run test:e2e`: 6 browser workflows passed, including a 10 question PDF + 10 solution PDF batch, automatic readiness, answer reveal after submission, MCQ and written feedback, follow-up, refresh/resume, completion, missing solutions and generated-answer labels, repair, inert HTML, mobile layout, clearing drafts, and cross-tab synchronization.
- Production build and startup checked; production library rendered with no browser page errors or horizontal overflow.
- The actual Anthropic SDK accepts the structured-output schemas; adapter tests exercise its request and response parsing with a local transport substitute. Tests replace external model responses; no live API quality claim is implied.

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

- A real uploaded question/key pair has now completed live conversion; see the dated update below. Question-by-question transcription fidelity and live grading quality still need human comparison against the originals.
- A local owner can deliberately open answer-visible repair routes. The app prevents accidental answer disclosure in practice, rather than trying to prevent its owner from inspecting their own files.
- Public multi-user deployment and automatic generation of missing reference solutions remain deferred as designed. This build is a personal local app and requires supplied official or externally generated reference solutions.

Before using AI, set `ANTHROPIC_API_KEY` in the ignored `.env.local`, then restart the app and worker. Claude Haiku 5.5 is the default for every role; the three `ANTHROPIC_MODEL_*` overrides are optional. The library can be used before configuration. No secrets or original student/course documents are committed.


## Claude provider update

The user requested Anthropic credentials and Haiku after the initial MVP implementation. New model operations now use `@anthropic-ai/sdk`, Claude Messages structured outputs, and `claude-haiku-5-5` by default. Internal input contracts no longer depend on OpenAI types. Model/figure routing, local validation, timeouts, saved work, and optional per-task model overrides are retained. Conversion cache keys explicitly include the Anthropic provider. API credentials are read server-side only; existing local environment values are preserved when adding the new settings.

Focused independent review found no Critical or Important issues. One deferred minor: the SDK can wrap a non-JSON prose refusal as a parse error before returning the stop reason; that case may receive the worker's bounded transient retries instead of the dedicated refusal message. Invalid output never becomes an assessment. Live Claude grading quality remains unaudited; the dated update below records live conversion results.

Official references checked on 2026-11-15: [Haiku 5.5 model](https://platform.claude.com/docs/en/models/haiku-5-5/overview), [structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs).

## Upload selection and first live-paper repair — 2026-11-15

Repeated file selection and drag/drop now append accepted files with visible filenames, safe previews, deduplication, removal and shared size/count limits. Browser regressions cover the original replacement bug and actual accumulated uploads.

The first course upload exposed pipeline defects: chunk-local observations were presented as global failures, paraphrased overlaps looked like conflicts, and answer extraction could return parent numbers instead of exact leaf subparts. Whole-document conversion is now used within bounded page/image budgets; larger documents carry explicit continuation state. Unfinished continuations remain blockers. Informational notes are separate from actionable issues. Stored originals can be converted again without reuploading or changing prior sessions.

Explanation, assessment and follow-up requests now include original referenced page images and related question context, including earlier code and sibling setup. Official MCQ correctness still follows the supplied key. Complete but cautious AI explanations carry a post-submission notice; structural extraction and answer-key checks remain strict.

The existing 15-page question PDF and 11-page solution PDF were reprocessed with Claude: 43 leaf questions/subparts, 41 supported reference answers and 41 prepared explanations, two drawing responses excluded, zero blocking issues, nine collapsed preparation notes. The paper published as Ready; all 41 explanation statuses are ready after six targeted context repairs. Originals were preserved and the local database was backed up. No production attempts were submitted. This establishes successful live conversion, not independently verified transcription or reasoning accuracy.

Fresh verification: lint, TypeScript, 49 tests across 22 files, 10 browser workflows and production build passed. Build retains three existing dynamic-filesystem tracing warnings. The restarted local app returned HTTP 200 with no browser page errors. Private source files, database backups and credentials remain ignored.
