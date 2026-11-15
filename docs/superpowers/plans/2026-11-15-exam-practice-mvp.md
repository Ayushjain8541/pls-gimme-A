# Exam Practice MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a student open a module folder, upload past papers and solutions, practise one original question at a time with immediate full feedback, and resume saved progress.

**Architecture:** A local Next.js application and a separate TypeScript worker share a SQLite database and private filesystem storage. A small Python subprocess extracts PDF pages; the worker uses server-side AI for structured parsing, explanations, written assessment, and follow-up answers. All navigation, review gates, persistence, and MCQ key comparison are application logic.

**Tech Stack:** Node 26 LTS, npm, Next.js App Router, React, TypeScript, Tailwind CSS, Zod, Drizzle ORM with better-sqlite3, OpenAI JavaScript SDK Responses API, Python 3.11+ with PyMuPDF, Vitest, Playwright. Pin resolved compatible stable dependency versions in lockfiles during execution; do not install prereleases. The current host has Node 26.9.0, npm 11.19.1, Python 3.9.6, and no `uv` executable; use the existing Node 26 runtime and provide Python 3.11+ during execution. No runtime installation has been performed.

**Spec:** [Approved design](../specs/2026-11-15-exam-practice-mvp-design.md).

## Global Constraints

- “One question at a time, followed by immediate full explanations; no hint/retry stage first.”
- “Typed responses suffice initially. Questions needing drawn answers can be skipped or excluded.”
- “Uploads happen inside a module folder selected by the student (for example CS2100 or CS2103); automatic module sorting is not required.”
- “Default to original paper order.”
- “Multi-select uses an exact set match initially; partial marking is deferred.”
- “Chat cannot silently alter the saved grade or official solution.”
- “AI-written explanations remain labeled as such even when the reference is official.”
- “Corrections create a new content revision.”
- “New sessions use the corrected revision; an active session must explicitly restart against it rather than mix versions silently.”
- “Practice without reference solutions is deferred.”
- Background preparation is schema conversion and required consistency checking, not a mandatory human review or a guarantee of academic correctness. Automatically activate successful conversions after explanations are prepared; route detected conversion problems to repair. The typical workflow is module → batch upload → background preparation → paper → answer/feedback → saved progress/completion.
- Implement within this workspace; local persistence only, no Docker, Redis, public deployment, account signup, automatic module sorting, or in-app solution generation.
- All HTTP handlers use the Node runtime. Bind web app to `127.0.0.1`; validate local Host/Origin on mutations. This is a single-user local app, not suitable for network exposure without authentication work.
- No implementation or dependency installation is authorized by this planning turn; execution follows plan review.

## Review Focus

1. Duplicate submit or stale autosave from two tabs must not duplicate attempts or replace newer drafts (Tasks 2, 7).
2. Refresh/restart during a worker call must preserve submissions and recover expired jobs without stale workers overwriting results (Tasks 4, 8).
3. A split question spanning pages must retain its parent context and figures without revealing an answer-key image (Tasks 5, 6).
4. A reference key, precomputed explanation, or solution asset must not leak through pre-submit player payloads or source routes (Tasks 3, 7).
5. A PDF with no usable text, bad numbering, corrupt/encrypted pages, or excessive size must become reviewable or fail intelligibly, never silently become ready (Tasks 3, 5).

## File map

Paths below are relative to the repository root. Bracketed route segments are literal Next.js directory names.

| Files/directories | Responsibility |
| --- | --- |
| `package.json`, `package-lock.json`, `.nvmrc`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `vitest.config.ts`, `playwright.config.ts`, `.env.example`, `.gitignore`, `README.md` | Reproducible setup, scripts, configuration |
| `src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx` | Shared shell, module library |
| `src/app/modules/[moduleId]/page.tsx`, `src/features/library/{service,components}.tsx` | Module-specific paper list and progress |
| `src/domain/{content,questions,feedback,practice}.ts` | Zod contracts and pure domain rules |
| `src/server/{config,context,http}.ts`, `src/server/db/{client,schema,migrate}.ts`, `drizzle/` | Local owner, request checks, database/migrations |
| `src/features/{documents,jobs,ingestion,review,practice,feedback,followup,batch}/` | Each feature owns its service, repository, UI as needed |
| `src/server/ai/{gateway,openai,prompts}.ts` | Provider boundary, prompt versions and structured calls |
| `src/worker/{main,runner}.ts`, `scripts/pdf/{extract.py,requirements.txt}` | Durable jobs and bounded PDF subprocess |
| `src/components/{RichContent,SourceViewer,StatusBadge}.tsx` | Safe content, source pages, status display |
| `src/app/api/` | Thin HTTP adapters listed below; no duplicated domain logic |
| `tests/{unit,integration,e2e,fixtures}/` | Deterministic fixtures, service/DB checks, browser flows |
| `scripts/verify-real-paper.ts`, `docs/verification/real-paper-checklist.md` | Opt-in real-document quality checks |

Use `.ts` rather than `.tsx` when a file has no JSX. Store runtime data under `.data/`, originals and derived assets outside `public/`, and ignore `.env.local`, `.venv/`, `.data/`, real papers, and generated screenshots in Git.

## Shared contracts and storage decisions

All IDs are server-created UUID strings, timestamps are UTC ISO strings, and page numbers are one-based. Zod schemas generate TypeScript types. UI data always passes through explicit DTO projection; never serialize database rows directly.

- `SourceRef = {documentId:string; page:number; bbox:[number,number,number,number]|null}`; PDF boxes are top-left-origin page points.
- `Block` is a discriminated union: `{kind:'markdown';text:string}` (math/tables/code, raw HTML disabled) or `{kind:'asset';assetId:string;alt:string}`. Assets reference question or solution roles, never arbitrary URLs.
- `Question` has `id, revisionId, number, order, parentNumbers:string[], context:Block[], prompt:Block[], marks:number|null, source:SourceRef[], requiresDrawing:boolean` and `kind:'single_select'|'multi_select'|'written'|'unsupported'`; selectable kinds require `options:{id:string;content:Block[]}[]`.
- `ReferenceAnswer` has `questionId, origin:'official'|'external_ai', content:Block[], source:SourceRef[], correctOptionIds:string[]|null, rubric:{id:string;text:string;maxMarks:number}[]|null, rubricOrigin:'supplied'|'ai_generated'|null`.
- `PreparedExplanation = {questionId:string;worked:Block[];byOption:Record<string,Block[]>;status:'ready'|'needs_review'}`; separate from reference content.
- `Response` is `{kind:'selection';optionIds:string[]}` or `{kind:'written';text:string}`.
- `Feedback` has `verdict:'correct'|'partly_correct'|'incorrect'|'unable_to_assess', provisional:boolean, strengths:string[], issues:{criterionId:string|null;evidence:string;explanation:string}[], worked:Block[], score:{earned:number;possible:number}|null, reference:ReferenceAnswer`.
- `PracticeItem` exposes question content only. `AttemptView` exposes feedback only once submitted; reference solution/source assets are attempt-gated.
- `PaperState = 'needs_solutions'|'queued'|'processing'|'needs_review'|'ready'|'failed'`; practice state is computed independently as `not_started|in_progress|completed`.
- `SessionProgress = {submitted:number;assessed:number;included:number;excluded:number;skipped:number;state:'not_started'|'in_progress'|'completed'}`. `submitted` counts distinct included items with a latest submitted attempt, not attempt rows. Completion requires assessed=included and included>0; all-excluded papers show “No supported questions”, never 100% completion.
- `Job` has `kind:'ingest'|'evaluate'|'followup', status:'queued'|'running'|'succeeded'|'failed', stage, payload, checkpoint, attempts, availableAt, leaseToken, leaseUntil, errorCode, errorMessage`; do not persist raw secrets/errors for browser display.

Tables: `owners` (seed `local`), `modules(ownerId,code,title)`, `documents(ownerId,moduleId,hash,mime,role,storageKey,originalName,byteLength)`, `papers(ownerId,moduleId,title,questionDocumentId,solutionDocumentId,solutionOrigin,state,activeRevisionId)`, `revisions(paperId,number,status,extractionVersion,contentHash)`, `questions(revisionId,number,order,contentJson)`, `answers(questionId,contentJson)`, `explanations(questionId,contentJson,promptVersion,model)`, `assets(documentId,role,page,bbox,storageKey)`, `reviewIssues(revisionId,questionId,code,resolution)`, `sessions(paperId,revisionId,position,createdAt)`, `sessionItems(sessionId,questionId,draftJson,draftVersion,skipReason,excluded)`, `attempts(sessionId,questionId,requestId,responseJson,status,feedbackJson,evaluatorVersion,contentHash,disputed)`, `messages(attemptId,role,text,status,requestId)`, `batchConfirmations(ownerId,moduleId,requestId,resultJson)`, `jobs` as above. Every table also has its primary key; add timestamps where needed for ordering. Use foreign keys, owner-scoped queries, unique module code per owner, unique question order/number per revision, unique request IDs, and unique revision fingerprint. Transactions publish revisions atomically; sessions pin immutable published revisions. Edits clone a published revision into a draft.

Configuration: `DATA_DIR=.data`, `DATABASE_PATH=.data/app.sqlite`, `PYTHON_BIN=.venv/bin/python`, `OPENAI_API_KEY`, `OPENAI_MODEL_INGEST`, `OPENAI_MODEL_FEEDBACK`, `OPENAI_MODEL_CHAT`. Model IDs are explicitly configured during execution, verified to support the required image and structured-output inputs. Missing credentials permit library/upload/review and show an actionable AI setup state, never synthetic successful results. Tests inject `AiGateway` and never spend API credits.

## HTTP boundary

All IDs are owner-scoped server-side. JSON errors use `{error:{code,message,retryable}}`; return 400 invalid input, 404 missing/inaccessible, 409 state/version conflict, 413 limit exceeded, 503 missing AI configuration. Async mutations return 202 with a job ID. Apply Origin/Host checks and Zod validation in `src/server/http.ts`.

| Route | Contract |
| --- | --- |
| `GET/POST /api/modules` | List/create `{code,title}` |
| `GET /api/modules/[moduleId]/papers` | Paper cards with preparation state and latest-session progress |
| `POST /api/modules/[moduleId]/documents` | Multipart file + role; return document metadata, no private paths |
| `POST /api/modules/[moduleId]/papers` | `{title,questionDocumentId,solutionDocumentId?,solutionOrigin?}` |
| `POST /api/papers/[paperId]/solutions` | Attach `{documentId,origin}` and queue preparation |
| `GET/PUT /api/papers/[paperId]/review` | Read/save draft revision with `expectedRevision`; saves validate content and mappings |
| `POST /api/papers/[paperId]/publish` | `{draftId,expectedRevision}`; publish after checks, or return 202 for explanation preparation then conditional publication |
| `POST /api/jobs/[jobId]/retry`, `GET /api/jobs/[jobId]` | Retry eligible failed job, poll safe progress |
| `POST /api/papers/[paperId]/sessions` | Resume latest pinned session or `{restart:true}` to create a new one |
| `GET /api/sessions/[sessionId]` | Question index, current PracticeItem, drafts, latest attempt states and progress; no unsubmitted answers |
| `PUT /api/sessions/[sessionId]/items/[questionId]` | `{draft?,expectedDraftVersion,position?,skipReason?,excluded?}` |
| `POST /api/sessions/[sessionId]/attempts` | `{questionId,response,requestId}`; save first, return AttemptView (pending for written) |
| `GET /api/attempts/[attemptId]` | Poll feedback or safe error state |
| `PATCH /api/attempts/[attemptId]` | `{disputed:true}` only |
| `GET/POST /api/attempts/[attemptId]/messages` | Read chat / enqueue `{text,requestId}` |
| `GET /api/documents/[documentId]/source` | Question original; solution original only in review context, with explicit answer-visible mode |
| `GET /api/assets/[assetId]` | Question assets or solution assets gated by a submitted attempt/review context |
| `POST /api/modules/[moduleId]/batch/preview`, `POST .../batch/confirm` | Suggest pairs from uploaded IDs; confirm explicit mappings before creating paper jobs |

Practice source viewing must never return solution originals via the question-source control. Review routes intentionally expose solutions because reviewing is an answer-visible operation; the player must neither call them nor prefetch them. This prevents accidental spoilers, not deliberate self-inspection of one's own locally owned answer files.

## Task 1: Runnable module library with persistent folders

**Files:** Create root configuration from the file map, `src/app/{layout.tsx,globals.css,page.tsx}`, `src/app/modules/[moduleId]/page.tsx`, `src/features/library/{service.ts,components.tsx}`, `src/server/{config,context,http}.ts`, `src/server/db/{client,schema,migrate}.ts`, initial `drizzle/` migration, module routes; tests `tests/integration/modules.test.ts`, `tests/e2e/library.spec.ts`.

**Interfaces:** `createModule(input:{code:string;title:string}):Promise<Module>` and `listModules():Promise<Module[]>`; `getLocalOwnerId():string`; `openDb(path:string):AppDb`. `Module={id,code,title}` (strings). Use WAL, foreign keys, and 5-second busy timeout; no DB connection during build imports.

- [ ] Write a failing integration test `module_survives_reopen`: create CS2100 and CS2103 in a temporary database, reopen it, assert both codes; duplicate CS2100 returns conflict. Browser test creates a folder and navigates into its empty paper list.
- [ ] Configure Node 26, Python 3.11+ virtual environment and minimal web/test configuration in the existing nonempty repo without overwriting docs. Install pinned stable packages; scripts: `dev` (loopback web), `worker`, `db:migrate`, `test`, `test:e2e`, `lint`, `typecheck`, `build`. `test` runs Vitest in non-watch mode; browser config starts the web app and worker against a temporary data directory. Run `npm test -- tests/integration/modules.test.ts`; confirm the test reaches the missing module implementation and fails, not a configuration error.
- [ ] Implement folder persistence, the local owner context, module HTTP handlers and library UI. `.env.example` lists the above settings without credentials; `/` shows module folders, and upload controls exist only within a selected module. `README.md` records setup, two-process startup and the personal-use boundary.
- [ ] Run `npm test -- tests/integration/modules.test.ts` and `npm run test:e2e -- tests/e2e/library.spec.ts`; expect both to pass against an isolated database.
- [ ] Commit only this task's files: `feat: add persistent module library`.

## Task 2: Versioned question and practice contracts

**Files:** Create `src/domain/{content,questions,feedback,practice}.ts`, expand `src/server/db/schema.ts` and migrations; tests `tests/unit/contracts.test.ts`, `tests/integration/revisions.test.ts`; fixtures `tests/fixtures/{mcq,written,shared-context}.json`.

**Interfaces:** Export the shared schemas/types above; `validateRevision(input:unknown):ValidationResult` where result is `{ok:true;revision:ParsedRevision}|{ok:false;issues:ReviewIssue[]}`; `computeProgress(items:ProgressItem[]):SessionProgress`. Define `ParsedRevision={questions:Question[];answers:ReferenceAnswer[];explanations:PreparedExplanation[]}` and `ReviewIssue={questionId:string|null;code:string;message:string}`. `ProgressItem={questionId:string;excluded:boolean;skipped:boolean;submitted:boolean;assessed:boolean}`.

- [ ] Add failing tests asserting `validateRevision` rejects duplicate numbering, missing choice targets and missing figure assets (asset existence is checked by the repository layer); assert `computeProgress` counts a twice-attempted item once, excludes drawing skips, leaves ordinary skips incomplete, and avoids completion for zero included items.
- [ ] Run `npm test -- tests/unit/contracts.test.ts tests/integration/revisions.test.ts`; expect failure at missing contracts/schema.
- [ ] Implement contracts, domain rules and migrations. Introduce `publishRevision(paperId:string,draftId:string,expectedRevision:number):Promise<string>` in `src/features/review/repository.ts`; preserve old revision rows and reject stale version publication with 409. Test atomic rollback when any included question lacks a usable reference.
- [ ] Run those tests and `npm run typecheck`; expect pass. Validate fixture examples include one single-select item, one multi-select item, and one written subpart with inherited context.
- [ ] Commit: `feat: define versioned paper and attempt contracts`.

## Task 3: Module-scoped upload and private source access

**Files:** Create `src/features/documents/{storage,service,limits}.ts`, module document/paper routes, source/asset routes, `src/components/SourceViewer.tsx`, `tests/integration/documents.test.ts`.

**Interfaces:** `saveDocument(moduleId:string,input:{name:string;mime:string;role:'question'|'solution';stream:ReadableStream<Uint8Array>}):Promise<DocumentMeta>`; `createPaper(moduleId:string,input:CreatePaperInput):Promise<PaperCard>`; `readAsset(assetId:string,access:SourceAccess):Promise<StoredFile>`. `CreatePaperInput` mirrors the HTTP table. Define `SourceAccess={mode:'question'|'review'|'attempt';attemptId?:string}` and check DB relationships, never trust mode alone. `DocumentMeta={id,name,role,byteLength,mime}`; `StoredFile={stream,mime,byteLength}`; `PaperCard={id,title,state,progress:SessionProgress}`.

- [ ] Add failing tests for correct module assignment, absent-solution state, cross-module pairing rejection, question-file magic bytes, `../` filename safety, blocked solution access from question mode, and oversized streamed files aborting with no committed document row.
- [ ] Run `npm test -- tests/integration/documents.test.ts`; expect missing service failures.
- [ ] Implement UUID storage keys, SHA-256 dedup within owner/module/role, atomic file writes and rollback cleanup. Limits: 25 MiB/PDF, 1 MiB/text or Markdown solution, 100 PDF pages (checked after parsing). Accept PDF signatures for question files; UTF-8 plain/Markdown and PDF for solutions. No remote URL imports, paths from clients, executable HTML, or public storage. Stream uploads, do not base64 them through server actions. Paper creation without a key returns `needs_solutions`; with key queues ingestion once Task 4 exists.
- [ ] Run document tests and `npm run typecheck`; expect pass. Verify rejected files do not remain addressable and original filenames never become filesystem paths.
- [ ] Commit: `feat: upload papers within module folders`.

## Task 4: Restart-safe background jobs and AI boundary

**Files:** Create `src/features/jobs/{repository,service}.ts`, `src/worker/{main,runner}.ts`, `src/server/ai/{gateway,openai,prompts}.ts`, job routes, `tests/integration/jobs.test.ts`, `tests/unit/ai-gateway.test.ts`.

**Interfaces:** `enqueueJob(kind:Job['kind'],key:string,payload:unknown):Promise<Job>`; `claimJob(workerId:string,now:Date):Promise<Job|null>`; `runNextJob(deps:WorkerDeps):Promise<boolean>`. `AiGateway` methods: `parseQuestions(input:QuestionParseInput):Promise<QuestionParseOutput>`, `parseSolutions(input:SolutionParseInput):Promise<SolutionParseOutput>`, `explain(input:ExplanationInput):Promise<PreparedExplanation[]>`, `evaluate(input:EvaluationInput):Promise<Feedback>`, `reply(input:ChatInput):Promise<string>`. Put input/output Zod schemas next to the interface; later tasks specify their fields. `WorkerDeps` injects DB, clock, AI and stage handlers. API schemas are object-rooted, with local domain validation after model parsing.

- [ ] Write failing tests: two workers cannot claim the same job; a dead worker's expired lease can be reclaimed; its late result cannot commit; an idempotent enqueue returns the same job; malformed AI output, refusal and timeout become typed recoverable errors.
- [ ] Run `npm test -- tests/integration/jobs.test.ts tests/unit/ai-gateway.test.ts`; expect missing runner/gateway failures.
- [ ] Implement transactional claim, 90-second leases renewed every 20 seconds, lease-token compare on all writes, stage checkpoints, and at most three automatic transient retries (2s, 10s, 30s) before manual retry. Ingestion timeouts apply per stage; cap AI requests at 120 seconds with lease renewal. Keep SQL transactions short and never across network/subprocess calls. Use SDK structured parsing, handle incomplete/refused output, and inject test fakes. Each model response records model/prompt versions without logging documents or keys.
- [ ] Run both test files; expect pass. Launching the worker without provider settings must report a setup error for AI jobs without discarding uploads; its process must not crash-loop.
- [ ] Commit: `feat: add durable worker and typed AI gateway`.

## Task 5: Extract and align a real paper into reviewable content

**Files:** Create `scripts/pdf/{extract.py,requirements.txt}`, `src/features/ingestion/{pdf,parse,align,validate,pipeline}.ts`, fixtures `tests/fixtures/pdfs/` (synthetic only), `tests/integration/ingestion.test.ts`, `tests/unit/alignment.test.ts`.

**Interfaces:** `extractPdf(documentId:string):Promise<ExtractedDocument>` with pages `{page,width,height,textBlocks:{bbox,text}[],imageAssetIds:string[],pageAssetId:string}[]`; `ingestPaper(paperId:string,deps:IngestionDeps):Promise<{revisionId:string;state:'ready'|'needs_review'|'failed'}>`. Define gateway parse inputs as document ID plus bounded page text/images and neighboring-page context; outputs return ordered hierarchical question candidates or numbered solution entries with explicit source refs and uncertainty. Server assigns IDs; model asset/source IDs must resolve to supplied manifests. `alignAnswers(questions:Question[],entries:SolutionEntry[]):AlignmentResult` returns mappings and review issues; ambiguous candidates remain unresolved.

- [ ] Add failing tests for Q2(a) spanning two pages, an answer numbered Q2(b) that must not align to Q2(a), a vector figure retained as a crop/page image, a scanned page using vision, and a corrupt/encrypted/101-page PDF producing explicit error codes. A repeated job checkpoint must not duplicate questions. A successful complete conversion becomes ready without a manual review action; a missing answer or unresolved mapping prevents automatic activation.
- [ ] Run `npm test -- tests/integration/ingestion.test.ts tests/unit/alignment.test.ts`; expect missing extractor/pipeline failures.
- [ ] Implement a Python subprocess invoked with argument arrays and no shell; read/write a validated JSON manifest in an owner-scoped temporary directory. Use PyMuPDF text blocks, full-page PNGs at 120 DPI, and bounded crops for figures. Reject encryption with `encrypted_pdf`; kill extraction after 60 seconds, limit 100 pages and 16 megapixels per rendered page. Save original source refs; fail visibly on unreadable pages.
- [ ] Implement per-document extraction checkpoints, question/solution parsing separately in windows of up to 4 pages plus one context page; deduplicate by numbering and source. Send text plus page images to the vision-capable ingestion model for difficult/scanned/layout-heavy pages. Check schema shape, hierarchy, shared context, options, source refs, asset resolution, and answer mappings. Detected omissions or ambiguous mappings become repair issues. When checks pass, run Task 6's explanation preparation and atomically activate the matching revision; no student review/publish click is needed. Keep conversion and explanation progress visible while processing. Consistency checks cannot prove that extracted or supplied answers are academically correct.
- [ ] Run ingestion/alignment tests and `.venv/bin/python scripts/pdf/extract.py --help`; expect pass/help. Tests exercise the real Python extractor on synthetic files and fake only AI responses.
- [ ] Commit: `feat: extract and align paper content for review`.

## Task 6: Review, source rendering, and prepared explanations

**Files:** Create `src/features/review/{service,components}.tsx` (service uses `.ts`), `src/components/{RichContent,StatusBadge}.tsx`, `src/app/papers/[paperId]/review/page.tsx`, review/publish routes, `tests/integration/review.test.ts`, `tests/e2e/review.spec.ts`.

**Interfaces:** `getReview(paperId:string):Promise<ReviewView>`; `saveReview(paperId:string,input:{expectedRevision:number;content:ParsedRevision;resolutions:IssueResolution[]}):Promise<ReviewView>`; `prepareExplanations(revisionId:string,ai:AiGateway):Promise<void>` uses `ExplanationInput={questions:Question[];answers:ReferenceAnswer[]}`. `ReviewView` includes draft content, source manifest, issues and optimistic version; `IssueResolution={issueId:string;action:'corrected'|'confirmed'|'excluded';note:string}`.

- [ ] Add failing tests: unresolved missing answers block publish; correcting a mapping clears its issue only after validation; excluded drawing items remain visible; script/HTML payloads never execute; question-context figures render but solution images are absent from the question pane; a published revision edit preserves old attempts.
- [ ] Run review tests and `npm run test:e2e -- tests/e2e/review.spec.ts`; expect failures at absent review behavior.
- [ ] Implement structured content/option editors, mapping picker, shared-context display, source page controls, exclusion controls, and validation errors. Use `react-markdown`, `remark-gfm`, `remark-math`, and `rehype-katex`; no raw HTML plugin, remote image fetching or model-written components. Resolve image blocks through authorized asset IDs.
- [ ] Generate worked/option explanations and optional labeled proposed rubrics before final activation. Initial ingestion invokes this stage automatically. For a manually repaired draft, the publish route queues an `ingest` job starting at the explanation checkpoint when outputs are missing or invalidated by edits; its payload pins draft ID, content hash and expected version. The worker prepares explanations and publishes only if those still match. A concurrent edit requires another publish request, never publishes stale feedback. Missing explanations are retryable and block ready status; the converted or corrected reference remains authoritative. Validate option coverage and any marks/rubric totals. `publishRevision` atomically activates the draft and marks the paper ready, never changes old sessions.
- [ ] Run review tests, browser test, and `npm run typecheck`; expect pass, including one review correction followed by successful publish.
- [ ] Commit: `feat: review extracted papers before practice`.

## Task 7: Saved question player and immediate MCQ feedback

**Files:** Create `src/features/practice/{repository,service,components}.tsx` (non-UI files `.ts`), `src/features/feedback/mcq.ts`, `src/app/papers/[paperId]/practice/page.tsx`, session/item/attempt routes, `tests/integration/practice.test.ts`, `tests/e2e/player.spec.ts`.

**Interfaces:** `startSession(paperId:string,input:{restart:boolean}):Promise<SessionView>`; `getSession(sessionId:string):Promise<SessionView>`; `saveItem(sessionId:string,questionId:string,input:SaveItemInput):Promise<{draftVersion:number}>`; `submitAttempt(sessionId:string,input:{questionId:string;response:Response;requestId:string}):Promise<AttemptView>`; `gradeMcq(question:Question,response:Response,answer:ReferenceAnswer,explanation:PreparedExplanation):Feedback`. `SaveItemInput` mirrors the HTTP table; `SessionView` exposes only the player DTO described above.

- [ ] Add failing tests: selecting wrong B shows B's explanation and reference after submit; multi-select order is irrelevant but extra choices fail; `external_ai` keys produce provisional feedback; duplicate request IDs return one attempt; stale draft versions return 409; pre-submit DTO recursively omits references, rubrics, correct IDs, explanations, and solution assets.
- [ ] Run practice tests and `npm run test:e2e -- tests/e2e/player.spec.ts`; expect missing player/service failures.
- [ ] Implement transactional submission, immutable attempts, 400ms debounced draft saves plus navigation flush, previous/next/skip/exclude, shared context and correct progress calculation. Do not auto-advance or ask for a retry before feedback. Persist the attempt before evaluating; written attempts enqueue Task 8's job. Submitted state and feedback survive browser reload. Prevent same-tab duplicate submission; DB request uniqueness is authoritative. Reattempt uses a new request ID and never destroys prior feedback.
- [ ] Implement answer-visible source controls only after submission; exclude prefetch/loading of review payloads in the player. Changing a published paper offers resume pinned version or explicit restart on the new version.
- [ ] Run practice tests and player browser tests; expect refresh/resume and MCQ flows pass. Browser network assertions confirm no solution request before submit.
- [ ] Commit: `feat: practise questions with saved MCQ feedback`.

## Task 8: Written assessment with recoverable AI feedback

**Files:** Create `src/features/feedback/{evaluate,service}.ts`, evaluation handler in `src/worker/runner.ts`, expand attempt route, `tests/integration/evaluation.test.ts`, `tests/e2e/written-feedback.spec.ts`.

**Interfaces:** `evaluateAttempt(attemptId:string,ai:AiGateway):Promise<AttemptView>`; `EvaluationInput={question:Question;answer:ReferenceAnswer;response:Response;prepared:PreparedExplanation}`. Provider returns assessment fields only; backend attaches the trusted stored reference, checks quoted response evidence against student text, and sets `provisional:true` for all written judgments. Export `validateAssessment(raw:unknown,input:EvaluationInput):Feedback`.

- [ ] Add failing tests for a partially correct written response, insufficient evidence returning unable-to-assess, fabricated reference fields ignored/rejected, score exceeding rubric bounds rejected, API timeout preserving response, restart reclaiming a pending assessment, and late worker result rejected by lease token.
- [ ] Run `npm test -- tests/integration/evaluation.test.ts`; expect missing evaluation failures.
- [ ] Implement criterion-based evaluation against the pinned reference. No marks without usable rubric; no exact-text correctness check for written/code-like text. Persist pending/succeeded/failed status and structured feedback atomically under the job lease; polling displays pending, safe failure with retry, or full explanation and official/external source label. Unable-to-assess with full reference counts as completed feedback but not correct/incorrect.
- [ ] Run evaluation tests and written-feedback browser test; expect answer-specific feedback persists after refresh and transient provider failure can be retried without a new attempt.
- [ ] Commit: `feat: assess typed answers with provisional explanations`.

**Milestone A:** Tasks 1–8 yield one module, one automatically prepared paper (or a repair flow if conversion has problems), both answer types, immediate full feedback after processing, skip and resume. Written AI assessment has explicit waiting time; “immediate” means it starts at submission, not a guarantee of zero network latency.

## Task 9: Question-scoped follow-up and disputed feedback

**Files:** Create `src/features/followup/{service,components}.tsx` (service `.ts`), message routes and job handler, `tests/integration/followup.test.ts`, `tests/e2e/followup.spec.ts`.

**Interfaces:** `askFollowup(attemptId:string,input:{text:string;requestId:string}):Promise<{messageId:string;jobId:string}>`; `getMessages(attemptId:string):Promise<ChatMessage[]>`; `flagDisputed(attemptId:string):Promise<void>`; `ChatInput={question:Question;answer:ReferenceAnswer;response:Response;feedback:Feedback;messages:{role:'user'|'assistant';text:string}[]}`; `ChatMessage={id,role,text,status}`.

- [ ] Add failing tests: no chat before completed feedback; duplicate request ID creates one user message; prompt-like student content cannot change a grade/reference; provider failure preserves the pending question; dispute flag changes no score or completion.
- [ ] Run `npm test -- tests/integration/followup.test.ts`; expect missing follow-up failures.
- [ ] Implement asynchronous non-streamed chat, with 4,000-character user messages and last 12 messages per model call while retaining full stored history. Pass pinned context without tool access. Render assistant replies with the safe renderer, no arbitrary asset URLs. Add “Question this feedback” and “Flag for review” within the feedback area; retain messages on resume.
- [ ] Run integration/browser follow-up tests; expect answers to appear beside the same attempt and grades remain immutable.
- [ ] Commit: `feat: discuss and flag question feedback`.

## Task 10: Missing solutions, library progress and completion summaries

**Files:** Create `src/features/documents/solution-prompt.ts`, `src/features/practice/summary.ts`, `src/app/papers/[paperId]/summary/page.tsx`, solution attach route; extend library/upload/player UI; tests `tests/integration/library-progress.test.ts`, `tests/e2e/missing-solutions.spec.ts`.

**Interfaces:** `buildExternalSolutionPrompt(paperTitle:string):string`; `attachSolution(paperId:string,input:{documentId:string;origin:'official'|'external_ai'}):Promise<{jobId:string}>`; `getSummary(sessionId:string):Promise<SessionSummary>`, with progress, correct/incorrect/partial/unassessable counts separated by confirmed/provisional, excluded/skipped items and attempt history links. Extend `listPapers(moduleId:string):Promise<PaperCard[]>` in library service.

- [ ] Add failing tests: a CS2100 upload never appears in CS2103; a question-only paper is stored and unstartable; attaching external solutions enqueues ingestion and retains `external_ai`; module cards show distinct-item progress across repeat attempts; latest-session restart shows new progress; zero supported items has no false 100% score.
- [ ] Run library-progress tests and missing-solutions browser test; expect missing behaviors fail.
- [ ] Implement copyable solution-generation prompt, upload/paste text or Markdown solution with explicit origin, attach-later flow, paper status/progress cards and summary. Prompt requests original numbering, every subpart, worked explanations, uncertainty, and “AI-generated, unverified”; no in-app model call generates reference answers. Keep absent-key content through browser reload. Module pages always expose upload inside their chosen folder.
- [ ] Run both test files; expect end-to-end question-only → external solution → review → practice works with labeled provisional results.
- [ ] Commit: `feat: add missing-solution workflow and paper progress`.

**Milestone B:** Tasks 9–10 complete the personal practice experience including follow-up, missing solutions, module progress, repeat attempts and summaries.

## Task 11: Batch upload, explicit pairing and independent recovery

**Files:** Create `src/features/batch/{pairing,service,components}.tsx` (non-UI `.ts`), batch routes, `tests/integration/batch.test.ts`, `tests/e2e/batch.spec.ts`.

**Interfaces:** `suggestPairs(moduleId:string,documentIds:string[]):Promise<PairingProposal[]>`; `confirmBatch(moduleId:string,input:{requestId:string;pairs:ConfirmedPair[]}):Promise<{paperIds:string[];jobIds:string[]}>`. `PairingProposal={questionDocumentId:string;solutionDocumentId:string|null;reason:string;uncertain:boolean}`; `ConfirmedPair={questionDocumentId:string;solutionDocumentId:string|null;solutionOrigin:'official'|'external_ai'|null;title:string}`. Pairing confidence is explanatory metadata, never an implicit confirmation.

- [ ] Add failing tests for 10 question + 10 solution files with misleading order, ambiguous duplicate filenames, a missing key, cross-module file IDs, duplicate confirm request, and one failed paper leaving the others usable.
- [ ] Run batch integration/browser tests; expect missing batch behavior fails.
- [ ] Implement sequential streaming uploads (up to 40 files per selection) with per-file progress; filename normalization proposes pairs, shared extracted title evidence can refine when available. Always show editable pairings and origin before confirmation; no automatic processing based on order. Allow question-only entries. Use a client-generated batch confirmation ID with DB uniqueness for idempotence; per-paper jobs reuse Task 4, with per-paper retry. Default worker concurrency is one, so batches queue without unbounded AI requests.
- [ ] Run batch tests; expect 10 confirmed pairs create exactly 10 independent jobs, and failure/retry preserves all other paper records.
- [ ] Commit: `feat: batch upload and confirm paper solution pairs`.

## Task 12: Verify the complete workflow and document real-paper limits

**Files:** Create `tests/e2e/full-practice.spec.ts`, `scripts/verify-real-paper.ts`, `docs/verification/real-paper-checklist.md`; update `README.md` and package scripts.

**Interfaces:** CLI `npm run verify:paper -- --question /absolute/path.pdf --solution /absolute/path.pdf --origin official --module CS2100`; explicit opt-in only, uses configured provider and local data, prints a safe review URL and job summary. No real paper content or student text in logs or Git. Test setup points app/worker at a temporary isolated database and injects `FakeAiGateway`; production cannot select the fake through an HTTP parameter.

- [ ] Add a failing full browser scenario: create CS2100/CS2103, batch upload 10 synthetic paper/solution pairs to CS2100, confirm pairings, wait for automatic conversion without visiting review, open the 2526 paper, answer wrong MCQ, see full option-specific explanation without navigation, answer written question, skip drawing item, refresh, complete, verify saved progress only in CS2100. Separately verify optional follow-up, a flagged conversion repair, and stale-draft two-tab and malicious Markdown cases if not already covered by prior browser tests.
- [ ] Run `npm run test:e2e -- tests/e2e/full-practice.spec.ts`; inspect any failures before changing behavior.
- [ ] Implement only remaining integration fixes and the verification CLI/checklist. Checklist manually compares every numbered item/subpart, option, diagram, mapping and explanation against the originals; includes correct, partial and incorrect student responses. Have the user supply a representative real paper and key if none is locally available; do not source private course papers or call untested synthetic results real validation. Real AI calls need configured keys/model IDs; disclose this concrete input dependency if it remains unavailable.
- [ ] Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e`, `npm run build`, and `git diff --check`; all must pass. Run the opt-in real-paper check when inputs are available; record exact observed extraction/grading defects and repair/review behavior. Otherwise record that real-paper fidelity remains unverified rather than blocking honest delivery of the working app.
- [ ] Commit verified code/docs: `test: verify complete local paper practice workflow`. Report actual commands and results; do not publish or merge remotely as part of this task.

## Implementation references

Checked during planning on 2026-11-15; consult again when locking versions rather than copying a provider example's model ID blindly:

- [Next.js installation and App Router setup](https://nextjs.org/docs/app/getting-started/installation).
- [Node.js supported release lines](https://nodejs.org/en/about/previous-releases).
- [Drizzle SQLite driver integration](https://orm.drizzle.team/docs/sqlite/get-started-sqlite).
- [OpenAI SDK structured Responses parsing](https://github.com/openai/openai-node/blob/main/docs/structured-outputs.md).
- [Structured output limitations and error handling](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses).
- [PyMuPDF page text and raster rendering](https://pymupdf.readthedocs.io/en/latest/page.html).
- [PyMuPDF virtual-environment installation](https://pymupdf.readthedocs.io/en/latest/installation.html).

## Plan review and execution boundary

Representative exact regression assertions below pin the highest-impact rules. Their variables are the fixtures/results created by the owning task's test setup; assertions supplement the scenario lists in those tasks.

```ts
// Task 1: module_survives_reopen
expect((await listModules()).map(m => m.code).sort()).toEqual(['CS2100', 'CS2103']);
// Task 2: an ordinary skip is incomplete; drawing exclusions do not count as wrong.
expect(computeProgress([
  {questionId:'a', excluded:false, skipped:false, submitted:true, assessed:true},
  {questionId:'b', excluded:false, skipped:true, submitted:false, assessed:false},
  {questionId:'c', excluded:true, skipped:true, submitted:false, assessed:false},
])).toEqual({submitted:1, assessed:1, included:2, excluded:1, skipped:1, state:'in_progress'});
// Task 3: uploading without a solution retains the paper.
expect(questionOnlyPaper.state).toBe('needs_solutions');
// Task 4: an expired worker cannot overwrite a reclaimed job.
expect(staleWorkerCommit.accepted).toBe(false);
// Task 5: Q2(b) never silently supplies the answer for Q2(a).
expect(ambiguousAlignment.issues.length).toBeGreaterThan(0);
// Task 6: a draft edited during explanation preparation cannot be published.
expect(stalePublish.status).toBe(409);
// Task 7: repeat request IDs refer to the same immutable attempt.
expect(secondSubmit.id).toBe(firstSubmit.id);
// Task 8: written results always communicate their uncertainty.
expect(writtenFeedback.provisional).toBe(true);
// Task 9: follow-up must not mutate the original assessment.
expect(attemptAfterChat.feedback).toEqual(attemptBeforeChat.feedback);
// Task 10: papers stay inside their selected module.
expect((await listPapers(cs2103.id)).map(p => p.id)).not.toContain(cs2100Paper.id);
// Task 11: confirmed pairs create independent jobs, including on a repeated request.
expect(new Set(confirmedBatch.jobIds).size).toBe(10);
expect(repeatedBatch.jobIds).toEqual(confirmedBatch.jobIds);
// Task 12: the full browser workflow shows option-specific feedback.
await expect(page.getByTestId('feedback-explanation')).toContainText(wrongOptionExplanation);
```

Self-review maps the spec to Tasks 1–12: module folders/progress (1,10), upload and provenance (3,10,11), structured ingestion and source fidelity (2,5,6), feedback and persistence (7,8), follow-up (9), revisions/recovery (2,4,6–8), real-document quality (12). Review Focus cases have explicit owning tests. No code, scaffold, dependencies, runtime credentials, or real AI validation have been produced by this plan.

Recommended execution is native in this session because the tasks share a small set of contracts and the first meaningful milestone is an integrated paper workflow. The alternative is subagent-driven task execution with an independent review per task, at greater context cost. Ask the user to review the plan and select the execution approach before implementation.
