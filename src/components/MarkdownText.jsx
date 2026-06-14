import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Thin wrapper around react-markdown sized for inline body copy in
// sidebars, list rows, and goal banners. Inline tailwind classes
// instead of the typography plugin so it works on Tailwind v4 without
// extra config.
//
// `compact` tightens vertical spacing for small surfaces; `dark` swaps
// link/code tones for the dark theme.
export default function MarkdownText({ children, dark = false, compact = false, className = "" }) {
  return (
    <div className={`max-w-none break-words ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => (
            <p className={compact ? "my-0.5 leading-snug" : "my-1.5 leading-relaxed"}>
              {children}
            </p>
          ),
          h1: ({ children }) => (
            <h1 className={`font-bold ${compact ? "text-base my-1" : "text-lg my-2"} ${dark ? "text-slate-100" : "text-slate-900"}`}>
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className={`font-bold ${compact ? "text-sm my-1" : "text-base my-2"} ${dark ? "text-slate-100" : "text-slate-900"}`}>
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className={`font-semibold ${compact ? "text-sm my-1" : "text-sm my-1.5"} ${dark ? "text-slate-200" : "text-slate-800"}`}>
              {children}
            </h3>
          ),
          ul: ({ children }) => (
            <ul className={`list-disc pl-5 ${compact ? "my-1 space-y-0" : "my-1.5 space-y-0.5"}`}>{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className={`list-decimal pl-5 ${compact ? "my-1 space-y-0" : "my-1.5 space-y-0.5"}`}>{children}</ol>
          ),
          li: ({ children }) => <li className="my-0">{children}</li>,
          a: ({ href, children, ...rest }) => {
            const isExternal = /^https?:\/\//.test(href || "") &&
              !(typeof window !== "undefined" && href?.startsWith(window.location.origin));
            return (
              <a
                href={href}
                className="underline text-[var(--color-accent)] hover:text-[var(--color-accent-hover)]"
                {...rest}
                {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              >
                {children}
              </a>
            );
          },
          code: ({ inline, children }) => (
            inline
              ? <code className={`px-1 py-0.5 rounded text-[0.85em] font-mono ${dark ? "bg-[var(--color-surface-raised)] text-slate-200" : "bg-slate-100 text-slate-800"}`}>{children}</code>
              : <code className="font-mono text-xs">{children}</code>
          ),
          pre: ({ children }) => (
            <pre className={`my-1.5 p-2 rounded-md overflow-x-auto text-xs ${dark ? "bg-[var(--color-surface)] border border-[var(--color-border)]" : "bg-slate-50 border border-slate-200"}`}>
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className={`border-l-2 pl-2 my-1.5 italic ${dark ? "border-slate-600 text-slate-300" : "border-slate-300 text-slate-600"}`}>
              {children}
            </blockquote>
          ),
          strong: ({ children }) => <strong className={`font-bold ${dark ? "text-slate-100" : "text-slate-900"}`}>{children}</strong>,
          em: ({ children }) => <em>{children}</em>,
          hr: () => <hr className={`my-2 ${dark ? "border-[var(--color-border)]" : "border-slate-200"}`} />,
        }}
      >
        {children || ""}
      </ReactMarkdown>
    </div>
  );
}
