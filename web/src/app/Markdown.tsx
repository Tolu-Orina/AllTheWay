import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

/**
 * Markdown, as a person reads it.
 *
 * Artifacts and agent replies are written as markdown. Showing the source
 * as a monospace dump makes a finished brief look like a draft. Preview
 * is the default; the canvas still has an edit path for corrections.
 *
 * HTML in the source is not rendered. react-markdown is text-only unless
 * we opt into raw HTML, which we do not.
 */

function safeHref(href: string | undefined): string | undefined {
  if (!href) return undefined;
  if (/^(https?:|mailto:|tel:|#|\/)/i.test(href)) return href;
  return undefined;
}

const components: Components = {
  a: ({ href, children }) => {
    const safe = safeHref(href);
    if (!safe) return <span>{children}</span>;
    return (
      <a href={safe} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    );
  },
};

export function Markdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div className={cn("md-body", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
