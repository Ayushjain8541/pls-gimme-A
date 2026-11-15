# Gimme A

A personal past-paper practice app. Open a module folder, upload papers and their reference solutions, then answer one question at a time with full feedback after submission. Attempts, drafts and progress stay on your computer.

## Run locally

Requirements: Node.js 26, npm, Python 3.11 or newer, and an Anthropic API key for conversion and written feedback.

```sh
npm ci
python3.13 -m venv .venv
.venv/bin/pip install -r scripts/pdf/requirements.txt
cp .env.example .env.local
```

Use your available Python 3.11+ executable in place of `python3.13` if needed. Set `ANTHROPIC_API_KEY` in `.env.local`. All AI tasks default to `claude-haiku-5-5`; model IDs are optional overrides. Set `ANTHROPIC_MODEL_INGEST`, `ANTHROPIC_MODEL_FEEDBACK`, or `ANTHROPIC_MODEL_CHAT` to choose another Claude model. All three roles need image inputs and structured outputs for figure-based questions. These are API credentials; a Claude chat subscription does not configure them automatically.

Start the web app and worker in separate terminals:

```sh
npm run dev
```

```sh
npm run worker
```

Open [the app](http://127.0.0.1:3000). The database is created automatically. Restart both processes after changing `.env.local`. The library and uploads work before AI configuration; queued preparation will need retrying after configuration. Without the worker, papers remain queued.

For a production-mode local run, use `npm run build` and `npm start`, alongside `npm run worker`. Keep the app bound to loopback. This version is for one local user; network exposure requires authentication and a separate deployment design.

## Workflow

1. Create a module such as CS2100, then open its folder.
2. Choose **Upload papers**. Select question PDFs and any corresponding solution files.
3. Check proposed file pairings and specify whether solutions are official or externally AI-generated.
4. Wait for background conversion. Successful papers become ready automatically. A conversion problem gets a repair screen rather than silently inventing missing content.
5. Open a ready paper. Submit an option or typed answer to see correctness, the reference answer and a full AI explanation. The player waits for you to move on.
6. Return later to resume. The module lists not-started, in-progress and completed papers with question counts.

Drawing/unsupported questions can be excluded without counting as incorrect. Ordinary skips stay incomplete. Open-ended grading and all judgments based on external AI solution files are provisional. A feedback follow-up chat explains the same question without changing the saved grade.

### Missing solutions

Upload the question paper first. Select **Add solutions** later to upload a PDF, plain text, Markdown, or pasted solutions. The dialog provides a prompt you can copy into another AI chat with your paper. Generated solutions are explicitly labeled; this app does not generate replacement reference solutions internally.

### Files and privacy

Question PDFs: up to 25 MiB and 100 pages. Solution PDFs have the same limits; text/Markdown solutions are limited to 1 MiB. Select up to 40 files in a batch. Files and SQLite data live in `.data/` and are not committed. No uploaded code or AI-generated HTML is executed. Original content and responses needed for each AI operation are sent to the Anthropic Claude API. Back up the entire data directory while the app and worker are stopped to preserve files and database together.

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
