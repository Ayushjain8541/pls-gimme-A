import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { portablePaper } from "../fixtures/portable-paper";
test("own-chat JSON workflow provides prompts, repairs a rejected file and practises without automatic AI", async ({
  page,
  request,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const mod = await (
    await request.post("/api/modules", {
      data: { code: `JSON${Date.now()}`, title: "Own ChatGPT imports" },
    })
  ).json();
  await page.route("**/api/status", (r) =>
    r.fulfill({ json: { aiConfigured: false } }),
  );
  await page.goto(`/modules/${mod.id}`);
  await page
    .getByRole("button", { name: "Import JSON", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Copy conversion prompt", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Copied conversion prompt" }),
  ).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "JSON Schema",
  );
  const download = await request.get("/api/import-format?download=example");
  expect(download.headers()["content-disposition"]).toContain("attachment");
  expect((await download.json()).formatVersion).toBe(1);
  await page.getByLabel("Paper JSON file", { exact: true }).setInputFiles({
    name: "paper.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"formatVersion":'),
  });
  await page
    .getByRole("button", { name: "Validate JSON", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Import paper", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Copy repair prompt", exact: true })
    .click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "Invalid JSON",
  );
  await expect(page.getByLabel("Repair prompt", { exact: true })).toHaveValue(
    /ENTIRE corrected/,
  );
  const p = portablePaper();
  p.title = "Imported practice";
  Object.assign(p.questions[0], { questionPages: [2, 3], answerPages: [4] });
  await page.getByLabel("Paper JSON file", { exact: true }).setInputFiles({
    name: "paper.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(p)),
  });
  await page
    .getByRole("button", { name: "Validate JSON", exact: true })
    .click();
  await expect(
    page.getByText("Ready to import: Imported practice", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Import paper", exact: true }).click();
  await expect(page.getByText("Ready", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Start practice", exact: true }).click();
  await expect(page.getByTestId("feedback-explanation")).toHaveCount(0);
  await expect(
    page.getByText("Largest signed 8-bit integer?", { exact: true }),
  ).toBeVisible();
  await page.getByRole("radio", { name: "B 255" }).check();
  await page
    .getByRole("button", { name: "Submit answer", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Incorrect", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("feedback-explanation")).toContainText(
    "Unsigned maximum.",
  );
  await page
    .getByRole("button", { name: "Next question", exact: true })
    .click();
  await page
    .getByLabel("Your answer", { exact: true })
    .fill("Zero uses one representation.");
  await page
    .getByRole("button", { name: "Submit answer", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Compare your answer", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Assess with AI (optional)",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".reference")).toContainText(
    "AI-GENERATED, UNVERIFIED",
  );
  await expect(page.getByTestId("feedback-explanation")).toContainText(
    "extra negative",
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Compare your answer", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: ".data/qa/json-self-review.png",
    fullPage: true,
  });
  const paperId = new URL(page.url()).pathname.split("/")[2];
  await page.goto(`/papers/${paperId}/review`);
  await expect(
    page.getByText(
      "To correct this paper, import a corrected JSON file from its module.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save and prepare", exact: true }),
  ).toHaveCount(0);
});
test("JSON paste corrections invalidate the validation summary and stay usable on mobile", async ({
  page,
  request,
}) => {
  const mod = await (
    await request.post("/api/modules", {
      data: { code: `JM${Date.now()}`, title: "JSON mobile" },
    })
  ).json();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/modules/${mod.id}`);
  await page
    .getByRole("button", { name: "Import JSON", exact: true })
    .first()
    .click();
  await page
    .getByLabel("Paper JSON", { exact: true })
    .fill(JSON.stringify(portablePaper()));
  await page
    .getByRole("button", { name: "Validate JSON", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Import paper", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Paper JSON", { exact: true }).fill("{");
  await expect(
    page.getByRole("button", { name: "Import paper", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: ".data/qa/json-import-mobile.png",
    fullPage: true,
  });
});

test("PDF attachments are visible before validation and resolve imported question and answer images", async ({
  page,
  request,
}) => {
  const mod = await (
    await request.post("/api/modules", {
      data: { code: `JP${Date.now()}`, title: "JSON with PDFs" },
    })
  ).json();
  await page.goto(`/modules/${mod.id}`);
  await page
    .getByRole("button", { name: "Import JSON", exact: true })
    .first()
    .click();
  await expect(
    page.getByLabel("Question PDF (optional)", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Answer key PDF (optional)", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Question PDF (optional)", { exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await expect(
    page.getByLabel("Answer key PDF (optional)", { exact: true }),
  ).toBeInViewport({ ratio: 1 });
  const dir = mkdtempSync(`${tmpdir()}/json-pdf-ui-`),
    file = dir + "/page.pdf";
  execFileSync(".venv/bin/python", [
    "-c",
    "import pymupdf,sys;d=pymupdf.open();p=d.new_page();p.insert_text((72,72),'Local source figure');d.save(sys.argv[1])",
    file,
  ]);
  const p = portablePaper();
  p.title = "JSON with source images";
  Object.assign(p.questions[0], {
    context: [
      {
        kind: "page",
        document: "question",
        page: 1,
        alt: "Original question figure",
      },
    ],
    questionPages: [1],
    answerPages: [1],
  });
  Object.assign(p.questions[0].answer, {
    content: [
      {
        kind: "page",
        document: "solution",
        page: 1,
        alt: "Original reference figure",
      },
    ],
  });
  await page.getByLabel("Paper JSON file", { exact: true }).setInputFiles({
    name: "paper.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(p)),
  });
  await page
    .getByRole("button", { name: "Validate JSON", exact: true })
    .click();
  await expect(page.getByLabel("Repair prompt", { exact: true })).toHaveValue(
    /Preserve existing valid page blocks/,
  );
  await expect(
    page.getByRole("listitem").filter({
      hasText: /Select the original PDF in "Question PDF \(optional\)"/,
    }),
  ).toBeVisible();
  await page
    .getByLabel("Question PDF (optional)", { exact: true })
    .setInputFiles({
      name: "questions.pdf",
      mimeType: "application/pdf",
      buffer: readFileSync(file),
    });
  await page
    .getByLabel("Answer key PDF (optional)", { exact: true })
    .setInputFiles({
      name: "answers.pdf",
      mimeType: "application/pdf",
      buffer: readFileSync(file),
    });
  await page
    .getByRole("button", { name: "Validate JSON", exact: true })
    .click();
  await expect(
    page.getByText("Ready to import: JSON with source images", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Repair prompt", { exact: true })).toHaveCount(
    0,
  );
  await page.screenshot({
    path: ".data/qa/json-pdf-attachments.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Import paper", exact: true }).click();
  await page.getByRole("link", { name: "Start practice", exact: true }).click();
  await expect(
    page.getByRole("img", { name: "Original question figure", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Original reference figure", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("radio", { name: "B 255" }).check();
  await page
    .getByRole("button", { name: "Submit answer", exact: true })
    .click();
  await expect(
    page.getByRole("img", { name: "Original reference figure", exact: true }),
  ).toBeVisible();
});

test("register dollars stay literal in imported questions while real LaTeX still renders", async ({
  page,
  request,
}) => {
  const mod = await (
    await request.post("/api/modules", {
      data: { code: `FMT${Date.now()}`, title: "Register formatting" },
    })
  ).json();
  const p = portablePaper();
  p.title = "Assembly formatting";
  p.questions = p.questions.slice(0, 1);
  const q = p.questions[0];
  q.number = "14";
  Object.assign(q, {
    context: [{ kind: "markdown", text: "A range formula is $2^n - 1$." }],
  });
  q.prompt = [
    {
      kind: "markdown",
      text: "The source register $t0 currently holds 0x12345678. Determine the value in $t1 after `andi $t1, $t0, 255`.",
    },
  ];
  q.options[0].content = [{ kind: "markdown", text: "0x78" }];
  q.options[1].content = [{ kind: "markdown", text: "0x12340078" }];
  q.options[0].explanation = [
    {
      kind: "markdown",
      text: "Correct: AND with zero-extended 0x00FF gives 0x78.",
    },
  ];
  q.options[1].explanation = [
    { kind: "markdown", text: "The upper half is cleared by the mask." },
  ];
  q.answer.content = [{ kind: "markdown", text: "0x78" }];
  q.explanation = [
    { kind: "markdown", text: "0x12345678 AND 0x000000FF = 0x78." },
  ];
  const result = await request.post(
    `/api/modules/${mod.id}/json-import/confirm`,
    { data: { text: JSON.stringify(p) } },
  );
  expect(result.status()).toBe(201);
  const paper = await result.json();
  await page.goto(`/papers/${paper.id}/practice`);
  await expect(
    page.getByText(
      /The source register \$t0 currently holds 0x12345678\. Determine the value in \$t1/,
    ),
  ).toBeVisible();
  await expect(page.locator(".katex")).toHaveCount(1);
  await expect(
    page.locator("code").filter({ hasText: "andi $t1, $t0, 255" }),
  ).toBeVisible();
  await page.screenshot({
    path: ".data/qa/register-formatting.png",
    fullPage: true,
  });
});

test("source Markdown can be prepared before JSON exists without importing a paper", async ({
  page,
  request,
}) => {
  const mod = await (
    await request.post("/api/modules", {
      data: { code: `SRC${Date.now()}`, title: "Verbatim source handoff" },
    })
  ).json();
  const dir = mkdtempSync(`${tmpdir()}/source-handoff-`),
    file = dir + "/input.pdf";
  execFileSync(".venv/bin/python", [
    "-c",
    "import pymupdf,sys;d=pymupdf.open();p=d.new_page();p.insert_text((72,72),'Keep this complete sentence, including this assumption.\\nA transfer takes seven cycles, including restart.');d.save(sys.argv[1])",
    file,
  ]);
  await page.goto(`/modules/${mod.id}`);
  await page
    .getByRole("button", { name: "Import JSON", exact: true })
    .first()
    .click();
  await page
    .getByLabel("Question PDF (optional)", { exact: true })
    .setInputFiles({
      name: "questions.pdf",
      mimeType: "application/pdf",
      buffer: readFileSync(file),
    });
  await page
    .getByLabel("Answer key PDF (optional)", { exact: true })
    .setInputFiles({
      name: "answers.pdf",
      mimeType: "application/pdf",
      buffer: readFileSync(file),
    });
  for (const [label, filename] of [
    ["Download question Markdown", "questions-source.md"],
    ["Download answer Markdown", "answers-source.md"],
  ]) {
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: label, exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(filename);
    const path = await download.path();
    expect(path).not.toBeNull();
    const text = readFileSync(path!, "utf8");
    expect(text).toContain(
      "Keep this complete sentence, including this assumption.",
    );
    expect(text).toContain("A transfer takes seven cycles, including restart.");
    expect(text).toContain("PDF page 1");
  }
  await expect(
    page.getByRole("button", { name: "Import paper", exact: true }),
  ).toBeDisabled();
  const papers = await (
    await request.get(`/api/modules/${mod.id}/papers`)
  ).json();
  expect(papers).toEqual([]);
});
