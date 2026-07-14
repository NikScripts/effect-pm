// Renders one namespace of the API reference — its symbols, each with the checker-resolved
// signature(s) (Shiki-highlighted) and the doc comment (through the shared JSDoc renderer, so
// `{@link}` and fenced code render exactly as they do in the twoslash hovers).

import * as React from "react";
import type { ApiNamespace, ApiSymbol } from "../lib/api.js";
import { highlightToReact, loadHighlighter, renderJsdocToReact } from "../lib/highlight.js";

// Raw `/** … */` → clean markdown: drop the comment fences and the per-line ` * ` gutter.
const cleanComment = (raw: string): string =>
  raw
    .replace(/^\s*\/\*\*/, "")
    .replace(/\*\/\s*$/, "")
    .split("\n")
    .map((l) => l.replace(/^\s*\* ?/, "").replace(/^\s*\*$/, ""))
    .join("\n")
    .trim();

// The description is everything before the block `@tag` section — cut at the first tag on its own
// line, and also drop a trailing inline visibility tag (some comments end "… the spec. @public").
const docLead = (raw: string): string =>
  cleanComment(raw)
    .split(/\n(?=@\w)/)[0]
    .replace(/\s*@(public|internal|category|since)\b.*$/s, "")
    .trim();

const Symbol = ({ s }: { s: ApiSymbol }): React.ReactElement => {
  const sigs = s.signatures.length > 0 ? s.signatures : s.typeText !== undefined ? [s.typeText] : [];
  const lead = docLead(s.rawComment);
  const chips = [
    ...(s.category !== undefined ? [{ cls: "api-chip-cat", text: s.category }] : []),
    ...s.linkTargets.map((t) => ({ cls: "api-chip-link", text: t })),
  ];
  return (
    <article className="api-sym" id={s.name}>
      <div className="api-sym-head">
        <code className="api-sym-name">{s.qualifiedName}</code>
        <span className={`api-kind api-kind-${s.kind}`}>{s.kind}</span>
        <span className="api-src">
          {s.source.file}:{s.source.line}
        </span>
      </div>
      {sigs.map((sig, i) => (
        <div className="api-sig" key={i}>
          {highlightToReact(sig, "ts")}
        </div>
      ))}
      {lead ? <div className="api-doc">{renderJsdocToReact(lead)}</div> : null}
      {chips.length > 0 ? (
        <div className="api-chips">
          {chips.map((c, i) => (
            <span className={`api-chip ${c.cls}`} key={i}>
              {c.text}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
};

export async function ApiEntrySection({ ns }: { ns: ApiNamespace }): Promise<React.ReactElement> {
  await loadHighlighter();
  return (
    <section className="api-ns">
      <h1 className="api-ns-title">
        {ns.entry}
        <span className="api-ns-count">{ns.symbols.length}</span>
      </h1>
      <div className="api-syms">
        {ns.symbols.map((s) => (
          <Symbol key={s.name} s={s} />
        ))}
      </div>
    </section>
  );
}
