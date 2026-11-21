import { test, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RichContent } from "../../src/components/RichContent";
const render = (text: string) =>
  renderToStaticMarkup(
    createElement(RichContent, { blocks: [{ kind: "markdown", text }] }),
  );

test("assembly register names do not turn question prose into mathematical notation", () => {
  const html = render(
    "The source register $t0 currently holds 0x12345678. Determine the value in $t1 after `andi $t1, $t0, 255`.",
  );
  expect(html).not.toContain('class="katex"');
  expect(html).toContain(
    "register $t0 currently holds 0x12345678. Determine the value in $t1",
  );
  expect(html).toContain("<code>andi $t1, $t0, 255</code>");
});
test("literal registers and real mathematical expressions can share a paragraph", () => {
  const html = render(
    "Read $s0 and $s1, then $s2 before evaluating $x^2 + 1$.",
  );
  expect(html).toContain("Read $s0 and $s1, then $s2 before evaluating ");
  expect(html).toContain('class="katex"');
  expect(html).toContain("x^2 + 1");
});
test("a single literal register before a mathematical expression does not consume its delimiter", () => {
  const html = render("The register $sp contains the result of $2^n - 1$.");
  expect(html).toContain("The register $sp contains the result of ");
  expect(html).toContain('class="katex"');
  expect(html).toContain("2^n - 1");
});
test("intentional register-like variables in LaTeX stay mathematical", () => {
  const html = render("Evaluate $t0 + t1$ and $t_0 + t_1$ and $sp + fp$.");
  expect(html.match(/class="katex"/g)).toHaveLength(3);
});
test("code fences, inline code and escaped dollar signs keep their literal content", () => {
  const html = render(
    "```mips\naddi $t0, $zero, 1\n```\nUse `$t1` and `$sp`. Escaped \\$s0 and \\$s1.",
  );
  expect(html).not.toContain('class="katex"');
  expect(html).toContain("addi $t0, $zero, 1");
  expect(html).toContain("<code>$t1</code>");
  expect(html).toContain("Escaped $s0 and $s1.");
});

test("a register before inline code does not insert escapes into the instruction", () => {
  const html = render("Register $t0 is used by `addi $t1, $t0, 1`.");
  expect(html).toContain("Register $t0 is used by ");
  expect(html).toContain("<code>addi $t1, $t0, 1</code>");
  expect(html).not.toContain('class="katex"');
});
