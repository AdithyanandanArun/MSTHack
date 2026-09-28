import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

/** GitHub-flavoured markdown, sanitized (no raw HTML, no scripts). */
export function Markdown({ children }: { children: string }) {
  if (!children.trim()) return <p className="muted italic">Nothing provided.</p>;
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
