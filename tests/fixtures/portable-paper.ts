export function portablePaper() {
  return {
    formatVersion: 1,
    title: "Practice paper",
    questions: [
      {
        number: "1",
        kind: "single_select",
        marks: 1,
        context: [],
        prompt: [{ kind: "markdown", text: "Largest signed 8-bit integer?" }],
        options: [
          {
            id: "A",
            content: [{ kind: "markdown", text: "127" }],
            explanation: [{ kind: "markdown", text: "Correct maximum." }],
          },
          {
            id: "B",
            content: [{ kind: "markdown", text: "255" }],
            explanation: [{ kind: "markdown", text: "Unsigned maximum." }],
          },
        ],
        answer: {
          origin: "official",
          content: [{ kind: "markdown", text: "127" }],
          correctOptionIds: ["A"],
        },
        explanation: [
          { kind: "markdown", text: "Signed range is -128 to 127." },
        ],
      },
      {
        number: "19(a)",
        kind: "written",
        marks: 2,
        context: [],
        prompt: [{ kind: "markdown", text: "Why is the range asymmetric?" }],
        options: [],
        answer: {
          origin: "external_ai",
          content: [
            {
              kind: "markdown",
              text: "Zero takes a nonnegative representation.",
            },
          ],
          correctOptionIds: null,
        },
        explanation: [
          { kind: "markdown", text: "One extra negative value is available." },
        ],
      },
    ],
  };
}
