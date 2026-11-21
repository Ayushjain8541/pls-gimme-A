/** Disambiguate bare assembly registers from single-dollar LaTeX delimiters.
 * Reparse the original Markdown after escaping only mistaken register dollars,
 * so neighbouring real equations and code retain their normal formatting.
 */
type Node = {
  type: string;
  children?: Node[];
  position?: { start: { offset?: number }; end: { offset?: number } };
};
const register =
  /^(?:zero|at|v[01]|a[0-3]|t[0-9]|s[0-8]|k[01]|gp|sp|fp|ra|f(?:[12]?[0-9]|3[01])|(?:[12]?[0-9]|3[01])(?=$|[\s,.;:!?]))(?![\w])/i;
const prose =
  /\b(?:is|are|was|were|the|and|or|in|at|of|if|then|which|when|register|value|content|contains|holds|before|after|from|into|with|suppose|would|executed)\b/i;
export function remarkRegisters(this: { parse: (source: string) => Node }) {
  const parse = this.parse.bind(this);
  return (tree: Node, file: { value?: unknown }) => {
    let source = String(file.value ?? "");
    // Usually one pass repairs a pair and a second restores a following equation.
    // Bound reparsing for pathological, heavily ambiguous uploaded Markdown.
    for (let pass = 0; pass < 8; pass++) {
      const escapes = new Set<number>();
      function walk(node: Node) {
        if (node.type === "inlineMath") {
          const start = node.position?.start.offset,
            end = node.position?.end.offset;
          if (
            start === undefined ||
            end === undefined ||
            source[start] !== "$" ||
            source[start + 1] === "$"
          )
            return;
          const body = source.slice(start + 1, end - 1);
          const opening = register.exec(body);
          if (!opening || body.length === opening[0].length) return;
          const closingIsRegister = register.test(source.slice(end));
          const containsProse =
            prose.test(body.slice(opening[0].length)) &&
            !/\\[a-z]+/i.test(body);
          if (!closingIsRegister && !containsProse) return;
          escapes.add(start);
          // A dollar swallowed from inside a code span must remain untouched;
          // escaping the opening register restores normal code parsing instead.
          if (closingIsRegister && !body.includes("`") && !body.includes("~~~"))
            escapes.add(end - 1);
        }
        node.children?.forEach(walk);
      }
      walk(tree);
      if (!escapes.size) break;
      for (const offset of [...escapes].sort((a, b) => b - a))
        source = source.slice(0, offset) + "\\" + source.slice(offset);
      Object.assign(tree, parse(source));
      file.value = source;
    }
  };
}
