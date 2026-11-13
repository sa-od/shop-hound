"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function BriefMarkdown({ markdown, compact = false }: { markdown: string; compact?: boolean }) {
  return (
    <article
      className={`prose prose-brief max-w-none prose-headings:font-cond prose-headings:font-bold prose-h2:mt-7 prose-h2:text-xl prose-h3:text-lg prose-a:underline-offset-2 prose-li:my-1 ${
        compact ? "prose-sm prose-ul:my-1 prose-ul:pl-4 prose-p:my-1.5" : ""
      }`}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
    </article>
  );
}
