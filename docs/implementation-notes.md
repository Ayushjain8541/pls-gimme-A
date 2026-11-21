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

## Second upload pair — ingestion reliability repair (2026-11-15)

Two additional uploads reproduced independent defects. Explanation batches accepted arbitrary IDs and counts; the model returned an extra context-only question and failed the paper. Per-batch structured output now restricts IDs to targets, requires exact coverage and rejects duplicates. Cached output that fails the current contract is evicted and regenerated, so a previously accepted invalid response cannot poison retries. Valid earlier stages remain reusable.

The longer solution PDF repeated summary keys and worked answers across overlapping windows. One pass also assigned an adjacent subpart's working to the wrong leaf. Conflicts now trigger a bounded, focused reread of the original source pages for that exact leaf. Successful complete rereads replace the disputed fragment and clear stale continuation state. Unreadable or genuinely conflicting originals still block publication. Regression tests cover both successful and unresolved rereads. Independent review found the stale continuation edge; it was reproduced and fixed.

Visual comparison of the first repaired upload also found a loop label attached to the preceding instruction and an inferred signal inversion in a figure caption. Both local transcriptions were corrected against the PDF in a new revision, preserving previous revisions and sessions. Four cautious explanations were regenerated and checked. Prompt guidance now emphasizes visual label alignment, neutral figure captions, source-image authority and arithmetic/constraint checks before alleging a reference discrepancy. These instructions reduce known failure modes but do not establish model correctness.

Fresh checks: 53 tests across 24 files, lint, TypeScript and 10 browser workflows passed. Production build passed with the three previously documented filesystem tracing warnings. No production answers were submitted as part of these repairs. Original uploads and official answer keys were preserved; a local database backup preceded the repairs.

Live outcome: both new papers published Ready. The first contains 39 leaf questions, 38 supported answers/explanations and one drawing exclusion, with zero remaining explanation cautions. The second contains 50 supported questions/answers/explanations and zero conversion blockers. Three false reasoning/assumption cautions were regenerated and checked; one remaining caution points to an annotation typo visibly present in the original supplied working, while retaining its final answer. All original document hashes match storage metadata. Both review pages returned HTTP 200 without browser page errors or horizontal overflow. Source/contract validation passed for both revisions. The app and worker were restarted with the final code. This is a targeted source and content check, not a complete independent mathematical audit of every explanation.

## JSON-first import — 2026-11-16

The module's primary action is Import JSON. It provides a full versioned conversion prompt, downloadable example/schema, file or paste entry, optional original PDFs for page-based figures/citations, structural validation and copyable repair instructions. Accepted content maps to the existing question/answer/explanation revision format and publishes atomically without worker jobs or model calls. Import provenance deduplicates repeated identical content/source selections per module. Invalid imports create no paper or original-JSON record. Optional PDF validation can populate the existing local page cache. Originals remain private; JSON originals contain answers and are exposed only through explicit review mode.

Imported written responses default to immediate reference self-review with no numeric score or claimed correctness verdict. A separate explicit action queues optional AI assessment; missing credentials leave the local reference and answer intact. Imported MCQs use the supplied key locally. Existing provider-based PDF conversion remains available and explicitly labelled optional. JSON imports are read-only in the legacy PDF repair screen, and its editing/publish endpoints reject imported papers. Corrections go through JSON import so questions, answers and explanations stay together. PDF reprocessing is also rejected for JSON imports.

The contract enforces exact leaf IDs, unique option IDs, valid answer keys, per-option explanations, nonempty content, rubric totals, source role/module ownership, physical page bounds and the separation between visible question content and hidden solution content. JSON is bounded to 4 MiB / 500 questions; existing PDF limits remain. It validates structure and references, not mathematical truth. Already published JSON replacement creates a new paper; rejected uploads can be corrected in the same dialog.

Initial verification: 67 unit/integration tests and 12 browser workflows passed, including clipboard conversion/repair, corrected-file retry, no-provider self-review, external answer labels, duplicate prevention, source ownership, answer-image isolation, mobile layout and the original PDF workflow. Desktop/mobile screenshots were inspected. Production build passed with the three pre-existing dynamic-filesystem tracing warnings. External ChatGPT conversion quality has not been independently benchmarked; the repair loop handles format failures.

Focused independent review identified that the legacy PDF editor clears explanations before regenerating them. JSON imports now have a read-only source review and reject that mutation path, preventing discarded or stale explanations. A regression reproduced the old failure and checks that published imported content stays intact. Summary labels distinguish ungraded self-review from failed/provisional assessment, imported explanations are labelled supplied in JSON, and optional AI requests do not remove completed reference-practice progress. Final verification passed 68 tests across 27 files, 12 browser workflows, lint, TypeScript and production build. The restarted production import dialog validated the downloadable example with no page errors; the original three papers remain Ready, no paper was created by the smoke check and no jobs were queued. A database backup preceded the additive migration.

## Self-contained external conversion instructions — 2026-11-16

Rewrote conversion and repair prompts around the full task rather than assumed knowledge of the product name. Shared instructions define source pairing, full-page/leaf coverage, exact fields and kinds, cross-field checks, source/key provenance, diagrams and answer separation, partial/unreadable input handling and final export checks. The machine-readable schema is still generated from the actual importer contract. The example now covers single-select, multi-select, written and retained unsupported leaves; an integration test imports that downloaded artifact without PDFs or provider jobs.

File-capable chats are instructed to produce a separate coverage/issue report alongside paper.json; the report is not part of the import schema. Raw-text fallback stays valid JSON, and globally blocked conversions should explain the blocker rather than manufacture a complete paper. Repair instructions explain zero-based validation paths and distinguish source-attachment problems from JSON-content problems. External-model compliance/answer accuracy has not been benchmarked by this wording change.

Verification for this prompt update: all 69 tests across 27 files, the two JSON-import browser workflows, lint, TypeScript and production build passed. Existing filesystem tracing warnings remain unchanged. The restarted app serves matching copy/download prompt content, all four example kinds and the expanded repair instructions. No external model calls or production paper imports were used to verify this wording change.

## JSON-only defaults and citation dependencies — 2026-11-16

A user-reported failure exposed a mismatch: external conversion instructions encouraged PDF page references, and the importer treated even informational questionPages/answerPages metadata as a mandatory source dependency. The default conversion/repair prompts now explicitly target self-contained Markdown JSON. PDFs attached in the external chat are source inputs, not required website uploads. Essential visual items that cannot be represented faithfully remain unsupported rather than carrying unresolved image pointers. PDF-backed page blocks remain an explicit optional mode.

The importer now accepts plain page citations without PDFs, retains them in the private original JSON and creates no invalid source links. If a corresponding PDF is explicitly attached, page bounds and ownership remain validated. Actual image blocks still require their source asset; the error explains the difference and gives a JSON-only repair path instead of only requesting another upload. Regressions cover no-PDF cited JSON import, missing-image rejection, and the browser's file-import workflow with citations and no source PDFs.

Verified this correction with all 71 tests, the two JSON import browser workflows, lint, typecheck and production build. The restarted production validator accepts text-complete JSON carrying page citations without PDF uploads (HTTP 200), while an unresolved image block gives one focused JSON-only repair error (HTTP 422). The served conversion prompt contains the explicit self-contained default. Smoke checks performed validation only, created no papers and made no external model calls.

## Discoverable PDF attachments in JSON import — 2026-11-17

A user could not find the source-PDF inputs because they were hidden in a collapsed disclosure after the large JSON textarea. The inputs now appear openly below the JSON file chooser, before pasted JSON, with shorter guidance and a responsive two-column layout. Both controls fit fully within the initial desktop viewport. Users can select the question and answer PDFs before validation; no error-first workflow or AI conversion is required.

A browser regression first reproduced hidden inputs, then caught controls clipped below the modal viewport. It now verifies initial visibility, JSON plus both local PDF uploads, successful validation/import, question-image display and answer-image withholding until submission. All three JSON browser workflows, 71 unit/integration tests, lint and TypeScript passed. Source PDFs remain optional for self-contained JSON and informational citations.

Production build passed with the three existing tracing warnings. The restarted local app shows both PDF fields fully inside the initial desktop modal viewport, with no browser page errors. Read-only production verification created no papers and submitted no answers.

## Assembly registers and math rendering — 2026-11-21

A question's stored Markdown was intact, but bare dollar-prefixed MIPS register names were paired as inline LaTeX delimiters, italicizing prose and suppressing its spaces. The shared renderer now detects register/prose delimiter collisions, escapes only the literal register dollars and reparses presentation Markdown. Intentional equations, inline/fenced code and escaped dollars remain supported. Stored questions, references, attempts and progress are not rewritten. External conversion/repair instructions also recommend inline-code formatting for assembly identifiers.

Six synthetic SSR regressions cover paired and odd register lists, a single register followed by genuine math, intentional register-like math variables, code fences, inline code and escaped dollars. The browser regression checks imported register prose alongside a real rendered equation. All 77 tests across 28 files, the focused browser workflow, lint, typecheck and production build passed. Independent focused review found no Critical/Important issues. Existing filesystem tracing warnings remain unchanged. No model calls or production attempts were used in this repair.
