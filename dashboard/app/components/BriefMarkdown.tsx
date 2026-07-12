"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function BriefMarkdown({ markdown }: { markdown: string }) {
  return (
    <article className="prose prose-invert prose-brief max-w-none prose-headings:font-semibold prose-h1:text-2xl prose-h2:mt-8 prose-h2:border-b prose-h2:border-zinc-800 prose-h2:pb-2 prose-a:no-underline hover:prose-a:underline prose-li:my-1">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
    </article>
  );
}
