import { test, expect } from "vitest";
import { mergeFiles, fileKey } from "../../src/features/batch/file-selection";
const file = (name: string, body = "paper") =>
  new File([body], name, { lastModified: 100 });
test("additional selections append in order and reselecting a file does not duplicate it", () => {
  const a = file("a.pdf"),
    b = file("b.pdf"),
    c = file("c.pdf");
  expect(
    mergeFiles([a, b], [a, c], "question").files.map((f) => f.name),
  ).toEqual(["a.pdf", "b.pdf", "c.pdf"]);
  expect(fileKey(file("a.pdf"))).toBe(fileKey(a));
});
test("a removed file can be selected again", () => {
  const a = file("a.pdf"),
    b = file("b.pdf");
  const initial = mergeFiles([], [a, b], "question").files;
  expect(
    mergeFiles(
      initial.filter((f) => fileKey(f) !== fileKey(a)),
      [a],
      "question",
    ).files.map((f) => f.name),
  ).toEqual(["b.pdf", "a.pdf"]);
});
test("unsupported and oversized additions cannot clear previously chosen papers", () => {
  const a = file("a.pdf");
  const result = mergeFiles(
    [a],
    [
      file("bad.txt"),
      new File([new Uint8Array(25 * 1024 * 1024 + 1)], "huge.pdf"),
    ],
    "question",
  );
  expect(result.files).toEqual([a]);
  expect(result.errors).toHaveLength(2);
});
test("solution files support text and Markdown with their smaller limit, and the batch capacity is enforced", () => {
  const a = file("a.md"),
    b = file("b.txt"),
    c = file("c.pdf");
  const result = mergeFiles([a], [b, c], "solution", 2);
  expect(result.files.map((f) => f.name)).toEqual(["a.md", "b.txt"]);
  expect(result.errors).toHaveLength(1);
  expect(
    mergeFiles(
      [],
      [new File([new Uint8Array(1024 * 1024 + 1)], "big.md")],
      "solution",
    ).files,
  ).toHaveLength(0);
});
