# Gimme A

A personal past-paper practice app. Use your own ChatGPT to turn exam PDFs into JSON, import it into a module folder, then practise one question at a time with immediate explanations. App-hosted AI conversion, assessment and chat are optional. Attempts, drafts and progress stay on your computer.

## Run locally

Requirements: Node.js 26 and npm. Python 3.11+ is needed only when reading source PDFs. An Anthropic API key is optional and used only for app-hosted AI features.

```sh
npm ci
python3.13 -m venv .venv
.venv/bin/pip install -r scripts/pdf/requirements.txt
cp .env.example .env.local
```

Use your available Python 3.11+ executable in place of `python3.13` if needed; Python setup can be skipped for text-only JSON imports. To enable optional AI features, set `ANTHROPIC_API_KEY` in `.env.local`. All AI tasks default to `claude-haiku-5-5`; model IDs are optional overrides. Set `ANTHROPIC_MODEL_INGEST`, `ANTHROPIC_MODEL_FEEDBACK`, or `ANTHROPIC_MODEL_CHAT` to choose another Claude model. All three roles need image inputs and structured outputs for figure-based questions. These are API credentials; a Claude chat subscription does not configure them automatically.

Start the web app:

```sh
npm run dev
```

For optional AI conversion, assessment or follow-up chat, start the worker in a separate terminal:

```sh
npm run worker
```

Open [the app](http://127.0.0.1:3000). The database is created automatically. Restart both processes after changing `.env.local`. JSON import, MCQ grading and written self-review work without AI configuration or a worker. Optional AI operations need the configured key and worker.

For a production-mode local run, use `npm run build` and `npm start`, alongside `npm run worker`. Keep the app bound to loopback. This version is for one local user; network exposure requires authentication and a separate deployment design.

## Workflow

1. Create a module such as CS2100 and open its folder.
2. Choose **Import JSON**, then **Copy conversion prompt**. A downloadable prompt, example JSON and JSON Schema are also available there.
3. Paste the prompt into your own ChatGPT (or another AI chat), attach the question PDF and answer key, and save its complete `.json` response. When no key is provided, generated solutions must use `external_ai` provenance.
4. Select that JSON file or paste it into the app. Attach the original question/answer PDFs too if the JSON uses diagram page blocks or source citations.
5. Choose **Validate JSON**. Errors have precise field paths and a **Copy repair prompt** action. Send that prompt with your previous JSON to your chat, then select its corrected file. Rejected files do not create a paper.
6. After validation, choose **Import paper**. It is ready immediately, without provider calls or background AI preparation. Reimporting the same content and source selections in the same module returns the existing paper.
7. Practise: MCQs grade locally against the supplied key; written responses immediately reveal the reference and worked explanation for self-review. **Assess with AI (optional)** explicitly requests a provisional written grade. Follow-up chat is another optional AI action. Answers remain hidden until submission.
8. Return later to resume. Module folders track progress and completion.

JSON files use `formatVersion: 1`, exact leaf numbers such as `19(a)` and `2(a)(ii)`, prepared explanations and explicit answer provenance. Images use portable page blocks such as `{"kind":"page","document":"question","page":3,"alt":"Original diagram"}` rather than application IDs or remote images. PDF page 1 is the first physical page, regardless of printed numbering. Question-facing content cannot reference answer-key pages. Validation checks structure, mapping and source availability; it does not independently establish answer correctness.

Drawing/unsupported questions are excluded from grading. Ordinary skips stay incomplete. AI-generated reference answers remain visibly unverified. Self-review does not claim a grade or award marks. Published revisions and previous attempts remain preserved. To replace a previously imported paper, import a corrected file as a new paper; rejected imports can be corrected and retried in the same dialog.

### Optional AI PDF conversion

Choose **Upload papers** instead of Import JSON to use the existing app-hosted AI flow. Select question PDFs and supplied solution files, review pairings and solution provenance, then confirm background preparation. This path requires an API key and worker. Ready papers support the existing immediate MCQ and provisional AI written feedback. Conversion issues remain visible for repair rather than silently inventing source material.

### Missing solutions

For the optional AI PDF flow, upload the question paper first. Select **Add solutions** later to upload a PDF, plain text, Markdown, or pasted solutions. The dialog provides a prompt you can copy into another AI chat with your paper. Generated solutions are explicitly labeled; this app does not generate replacement reference solutions internally.

### Files and privacy

JSON imports: up to 4 MiB and 500 questions per file. Question PDFs: up to 25 MiB and 100 pages. Solution PDFs have the same limits; text/Markdown solutions are limited to 1 MiB. Select up to 40 files in a batch. Files and SQLite data live in `.data/` and are not committed. No uploaded code or AI-generated HTML is executed. JSON validation, import and reference practice do not send content to a provider. Original content and responses needed for an explicitly selected AI operation are sent to the Anthropic Claude API. The external chat you use for conversion has its own privacy terms. Back up the entire data directory while the app and worker are stopped to preserve files and database together.

## Verification

```sh
npm run lint
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run build
```

Unit/integration tests use isolated temporary SQLite databases and synthetic PDFs. Browser tests run the actual web app and worker against a separate `.data/e2e/` directory, replacing only the external AI provider with a fixture adapter. They do not use API credits. The fixture adapter exists only in `tests/`, and cannot be selected through the application API.

For an explicit live check with your own real files and configured API account:

```sh
npm run verify:paper -- --question /absolute/path/paper.pdf --solution /absolute/path/solutions.pdf --origin official --module CS2100
```

See [the real-paper checklist](docs/verification/real-paper-checklist.md). Passing synthetic tests does not establish extraction or grading quality on your actual course papers.

Design and implementation plan are under `docs/superpowers/`.
