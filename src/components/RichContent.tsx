"use client";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { remarkRegisters } from "./remark-registers";
import type { Block } from "@/domain/content";
export function RichContent({
  blocks,
  attemptId,
  review = false,
}: {
  blocks: Block[];
  attemptId?: string;
  review?: boolean;
}) {
  return (
    <div className="rich">
      {blocks.map((b, i) =>
        b.kind === "markdown" ? (
          <Markdown
            key={i}
            remarkPlugins={[remarkGfm, remarkMath, remarkRegisters]}
            rehypePlugins={[rehypeKatex]}
            components={{
              img: () => null,
              a: ({ href, children }) => (
                <a href={href} target="_blank" rel="noreferrer">
                  {children}
                </a>
              ),
            }}
          >
            {b.text}
          </Markdown>
        ) : (
          <figure key={i}>
            <img
              src={`/api/assets/${encodeURIComponent(b.assetId)}?${review ? "review=true" : `attemptId=${encodeURIComponent(attemptId || "")}`}`}
              alt={b.alt || "Question figure"}
              loading="lazy"
            />
          </figure>
        ),
      )}
    </div>
  );
}
