/**
 * Message body renderer — react-markdown (raw HTML passthrough deliberately NOT
 * enabled; markdown text is never trusted as HTML) with Shiki-highlighted code
 * fences. Shiki's output is escaped token spans, not the source treated as HTML,
 * so `dangerouslySetInnerHTML` here is the standard safe pattern for its output.
 *
 * @internal
 */
import * as React from "react";
import ReactMarkdown from "react-markdown";
import { codeToHtml } from "shiki";

const CodeBlock = (props: {
  readonly className?: string;
  readonly children?: React.ReactNode;
}): React.ReactElement => {
  const lang = /language-(\w+)/.exec(props.className ?? "")?.[1] ?? "text";
  const code = String(props.children ?? "").replace(/\n$/, "");
  const [html, setHtml] = React.useState<string | undefined>(undefined);

  React.useEffect(() => {
    let cancelled = false;
    codeToHtml(code, { lang, theme: "github-dark" })
      .then((out) => {
        if (!cancelled) setHtml(out);
      })
      .catch(() => {
        // Unknown/unsupported language — fall back to the plain <pre> below.
      });
    return () => {
      cancelled = true;
    };
  }, [code, lang]);

  if (html === undefined) {
    return (
      <pre>
        <code>{code}</code>
      </pre>
    );
  }
  // shiki output is escaped token spans, not raw source, so this is the standard safe pattern.
  return <div className="code-block" dangerouslySetInnerHTML={{ __html: html }} />;
};

export const Markdown = (props: { readonly text: string }): React.ReactElement => (
  <ReactMarkdown
    components={{
      // CodeBlock (fenced) and the fallback <code> already render their own wrapper
      // (a <pre> or the shiki <div>) — react-markdown's default <pre> would nest
      // invalidly around it, so pass its children through untouched instead.
      pre: (preProps) => <>{preProps.children}</>,
      code(codeProps) {
        const { className, children } = codeProps;
        if (className?.includes("language-") === true) {
          return <CodeBlock className={className}>{children}</CodeBlock>;
        }
        return <code>{children}</code>;
      },
    }}
  >
    {props.text}
  </ReactMarkdown>
);
