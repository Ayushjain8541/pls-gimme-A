# Exam practice MVP design

Date: 2026-11-15 (Asia/Singapore)
Status: Approved by the user on 2026-11-15; implementation planning authorized, implementation not started.

## Intent and success

Turn a student's existing past papers into focused practice: show one original question, accept an answer, immediately explain the result in full, and let the student move on when ready. The immediate value is understanding a mistake while the question is still fresh. Long-term personalized notes and pattern analysis can follow once this loop works reliably.

First usable result: the student uploads a real question PDF and a corresponding solution file, reviews any extraction problems, answers MCQs and typed open-ended questions, receives reference-grounded feedback, and can return to saved progress.

## Decision provenance

The conversation is authoritative. The supplied `/Users/ayush/Downloads/exam_practice_mvp_codex_brief.md` is supporting context, not an instruction to implement everything it lists.

Confirmed by the user:

- One question at a time, followed by immediate full explanations; no hint/retry stage first.
- AI structures uploaded papers for display and supplies explanations/evaluation.
- MCQ explanations may be prepared during upload; open-ended evaluation waits for the student's response.
- Official solutions are usually available, but not always. A prompt for generating solutions externally is an acceptable initial workaround.
- Typed responses suffice initially. Questions needing drawn answers can be skipped or excluded.
- The chosen approach is a structured paper player with AI feedback, starting with one paper end to end before batch uploads.
- No browser mockups are wanted during this design discussion.
- Uploads happen inside a module folder selected by the student (for example CS2100 or CS2103); automatic module sorting is not required.
- Each module lists its papers with not-started, in-progress, and completed states and question-level progress.
- Background preparation means converting uploaded papers and solutions into the fixed schema the website renders. The normal workflow has no mandatory manual content review: successfully prepared papers become ready automatically, with repair available for conversion problems.

The remaining choices below originated as assistant proposals and were included in the approved design.

## Approaches

| Approach | Benefit | Tradeoff | Decision |
| --- | --- | --- | --- |
| Structured paper player with AI feedback | Consistent navigation, traceable answers, saved attempts, predictable grading paths | Requires a question schema and ingestion review | Selected by the user |
| Chat-first tutor | Quick conversational prototype | Harder to track exact question order, completion, and answer presentation | Considered, not selected |
| Agent-controlled practice interface | Flexible presentation and orchestration | Adds layout and interaction uncertainty before the core loop is proven | Considered, not selected |

The selected approach still uses AI centrally. AI supplies content and judgments within application-defined structures; application code controls rendering, navigation, progress, and deterministic MCQ checks.

## Goals, non-goals, and failure conditions

Goals:

- Preserve original questions, numbering, subparts, options, figures, and source references.
- Support single-select and multi-select MCQs plus typed written answers.
- Show the reference answer and full explanation after submission, with no automatic advance.
- Organize papers by module and preserve attempts and resume position.
- Make uncertain extraction and uncertain evaluation visible and repairable.
- Accept both official and externally generated solutions with distinct provenance.

Deferred:

- In-app generation of missing reference solutions.
- DOC/DOCX and arbitrary document formats; begin with question PDFs and solution PDF, plain text, or Markdown.
- Handwriting upload, drawing input, executable code evaluation, and timed exam mode.
- Adaptive selection, spaced repetition, personalized notebooks, recurring-misconception tracking, and exam predictions.
- Topic practice, social features, and agent-generated layouts.

Failures even if the app technically works:

- Silently dropping a diagram or pairing a question with the wrong answer.
- Presenting an AI explanation or external generated solution as official material.
- Claiming to know the student's reasoning from an MCQ selection alone.
- Counting skipped drawing questions as incorrect or losing submitted work on refresh.
- Requiring manual reconstruction of every question before a paper can be used.

## Scope and delivery boundary

This is a project requiring a full design and implementation plan. Build the complete loop for one paper first; then expand the same pipeline to batches. The first delivery is a personal-use web app with saved data on a persistent local backend, not a public multi-user service. This is an assistant proposal intended to avoid authentication and deployment work obscuring the learning loop. Keep user ownership explicit in stored records so a hosted version can follow. AI processing requires internet access and configured server-side provider credentials; no offline AI is promised.

Use this existing Git workspace for design artifacts and implementation. At initial inspection it had no commits or configured remote; design artifacts are now committed. The provided GitHub repository is the intended eventual destination; connecting or publishing it is separate from approving this design. Do not create a second project directory during brainstorming.

## Paper preparation

1. Create/open a module and upload a question PDF.
2. Attach a solution PDF or paste/upload plain text or Markdown. Designate its origin as official or externally generated. Uploaded does not imply official.
3. If solutions are absent, retain the question paper with a `needs_solutions` state and offer a copyable external-generation prompt. Feedback practice becomes available when solutions are supplied and aligned. Practice without reference solutions is deferred.
4. Process questions and solutions into schema-validated data. Preserve the original files and page references, including question figures as image assets when needed.
5. Align solutions by question/subpart identifiers and content. Flag missing answers, ambiguous matches, unreadable content, or unsupported questions. Schema validity alone does not establish fidelity.
6. Check conversion output for usable structure, valid option/answer references, resolved assets, and detected missing or ambiguous content. These are conversion consistency checks, not a separate promise to verify academic correctness. Show repair/source access when conversion fails or needs attention; allow correction, confirmation, or exclusion of flagged items. Do not require a manual review of every paper.
7. Prepare concise worked explanations and, for MCQs, explanations for incorrect options. Store these separately from the supplied solution.

After conversion, required consistency checks, and explanation preparation succeed, activate the paper automatically. Example normal flow: open CS2100, upload 10 papers and their available solutions, wait for background preparation, open the 2526 paper, answer one question at a time without seeing its answer first, read feedback after submitting, and return to see saved progress or completed status. Optional follow-up and repair tools do not interrupt this loop. Papers lacking solutions retain the previously agreed attach-solutions workflow; the app does not generate reference solutions internally.

Prefer text extraction where usable, with page-image/vision processing for scans and difficult layouts. Mixed and scanned PDFs should receive an attempted extraction or a clear review/failure state, never an empty success. Preserve source context for any figure or equation that cannot be reliably transcribed.

The external-generation prompt asks the student to attach the question paper and requests original question numbering, all subparts, worked reasoning, explicit uncertainty, and the label “AI-generated, unverified.” Its output format is a convenience, not proof that solutions are correct. The app parses imperfectly formatted outputs through the same review process. Preserve the user-declared origin and label unsupported grading as provisional.

## Practice behavior

Default to original paper order. A practice item is an answerable leaf subpart, with all parent instructions, shared passages, figures, and dependencies visible. Keep linked subparts grouped in navigation so splitting does not remove context. Preserve numbering such as `2(a)(ii)`.

- MCQs use selectable options; written items use a text area with multiline working. Rendering supports equations, tables, and code in the question. Answers remain typed text initially.
- Submit saves the response and reveals correctness/evaluation, the supplied reference answer, and the full explanation. Feedback stays on screen until the student chooses another question.
- Correct responses also receive an explanation, without forcing the student to read or acknowledge it.
- Previous, next, ordinary skip, and “Skip: requires drawing” are available. Preserve question diagrams even when drawn responses are unsupported.
- Ordinary skips remain unanswered. Drawing-required or otherwise unsupported items can be explicitly excluded, remain visible in the paper index, and receive no incorrect score.
- An attempt is a fixed submitted response with its feedback. Reattempting creates a new attempt; it does not overwrite history. Drafts and the current position are saved as well.
- Completion means every included item has a submitted response and completed feedback. Provisional assessment can count as completion, with uncertainty shown. Excluded items appear separately in the summary. A failed evaluation can be retried without resubmitting the answer.

## Feedback and follow-up questions

MCQs are graded by matching option IDs or option sets against the converted reference key, manually corrected when needed. Multi-select uses an exact set match initially; partial marking is deferred. Precomputed option feedback explains why the option is invalid and the relevant distinction, without claiming this was the student's actual thought process.

Written evaluation uses the question, submitted response, reference solution, and any supplied rubric. Return a provisional correct/partly correct/incorrect assessment, what was correct, what was missing or wrong, and a worked explanation. If evidence is insufficient, return “unable to assess” with the reference answer rather than fabricate a verdict. Show a provisional numeric score only when marks and a usable rubric support one; enforce score bounds in application code. A proposed AI rubric is labeled as generated.

After feedback, allow a question-scoped follow-up conversation: for example, asking why a step was wrong or challenging the explanation. This preserves the original user's ability to question feedback without turning the app into a general chat interface. Ground responses in the current question, solution, submitted answer, and feedback; retain the conversation with the attempt. Chat cannot silently alter the saved grade or official solution. Let the student flag disputed feedback and manually mark it for review; automatic regrading from chat is deferred.

Always display solution origin. Assessments based on externally generated solutions are provisional, including MCQ correctness; matching a key does not validate that key. AI-written explanations remain labeled as such even when the reference is official. Show the reference solution and source access so the student can verify it.

## Application structure and stored records

Use a conventional typed web application with a server-side AI integration, durable database, original-file/asset storage, and background ingestion jobs. Exact frameworks, model/provider, database product, and queue library are left to the implementation plan. Prefer a coherent small stack over separate services with no demonstrated need. No installation is needed to approve this design.

Separate these records and responsibilities:

- Modules own papers; papers reference question and solution documents and their provenance.
- Versioned extraction outputs hold question hierarchy, typed rich content, ordered options, marks, asset references, answer mappings, source references, review flags, and exclusion state.
- Reference solutions and AI explanations are separate fields/records with separate provenance.
- Jobs record stage, progress, errors, and retryable work. Each paper is independent; one failure cannot block the batch. Reuse unchanged processing where valid.
- Sessions store the selected paper, draft answers, and position. Attempts store submitted answers, evaluation state, feedback, evaluator version, and associated content revision. Follow-up messages reference the attempt.
- Paper ingestion readiness is separate from practice completion. Resume must never imply a failed extraction became ready.

AI outputs must pass structural validation plus domain checks for numbering, options, answer references, assets, and grading bounds. Rich content cannot execute uploaded or model-generated code. Files and AI calls stay behind the backend; local credentials are never sent to the browser. Documents and student input are untrusted content, not authority for model tool use or application behavior.

Corrections create a new content revision. Completed attempts retain their original question/solution snapshot or immutable revision reference so a repair does not rewrite history. New sessions use the corrected revision; an active session must explicitly restart against it rather than mix versions silently.

## Screen responsibilities

- Library/module view: folders, papers, preparation state, and practice progress. Open a module before uploading; uploads inherit that module, with no automatic module classification. Show not started, in progress, or completed, plus submitted/total included question counts for the latest session.
- Upload/preparation view: files, solution origin, missing-solution prompt, and processing progress.
- Review view: extracted questions/solutions, source-page access, corrections, and exclusions.
- Player: one item, required context, answer controls, feedback, source access, follow-up questions, and navigation.
- Summary: attempted and skipped counts, excluded items, confirmed-key results, provisional assessments, and ability to revisit.

Batch upload later adds explicit pairing review and independent job progress, reusing the same paper preparation and review model.

## Delivery sequence and acceptance

These are design boundaries, not the detailed implementation plan:

1. One paper: upload question/solution files, extract, review, practise both MCQ and written items, explain, ask a follow-up, save and resume.
2. Missing-solution workflow and module library: external prompt, attach solutions later, source labels, repeat attempts, and useful summaries.
3. Batch preparation: upload multiple papers and solutions, confirm pairings, process independently, retry failures, and track preparation separately from practice progress.

Validate with manually checked real papers containing MCQs, written questions, shared subpart context, equations/figures, and at least one unsupported drawing task. Check a missing-solution case, an externally generated solution, an intentionally ambiguous answer mapping, an AI failure, and refresh/resume. Assessment quality needs checked student responses, not merely valid JSON. A representative real paper/solution pair is an implementation-time input; do not claim extraction reliability before trying it.

Acceptance is the first usable result above plus: wrong MCQ feedback explains the selected distractor; written feedback addresses the submitted text; uncertainty and origin stay visible; skipped unsupported items do not reduce correctness; source materials are accessible; and a processing/evaluation failure preserves work and can be retried.

## Builder discretion and approval

The builder chooses exact schema names, API boundaries, components, parsing/model tools, rich-text representation, operational limits, and meaningful verification checks in the implementation plan. Those choices must preserve the behaviors and scope above. Confirm current tool capabilities against official documentation when planning integrations.

Particular assistant proposals to review: personal-use local delivery first; PDF-first document support with text/Markdown solutions; no feedback practice until solutions are attached; a compact follow-up chat in the first usable loop; and the explicit exclusion/completion rules.

User approval received. Next create the detailed implementation plan before product code or scaffolding.
