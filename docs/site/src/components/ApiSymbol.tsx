// Two views of one API symbol: a compact row for the namespace index (no Shiki — keeps those pages
// small) and the full card for its own page (checker-resolved signatures Shiki-highlighted, doc
// comment through the shared JSDoc renderer). loadHighlighter() must run before rendering a card.

import * as React from "react";
import type { ApiSymbol as Sym } from "../lib/api.js";
import { highlightToReact, renderJsdocToReact } from "../lib/highlight.js";

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

// The row summary is plain text, so flatten inline markdown: {@link X} → X, drop `` ` `` and `*`.
const plain = (s: string): string =>
  s.replace(/\{@link\s+([^}|\s]+)[^}]*\}/g, "$1").replace(/[`*]/g, "");
const firstSentence = (s: string): string => {
  const i = s.indexOf(". ");
  return i > 0 ? s.slice(0, i + 1) : s;
};

export const ApiSymbolRow = ({ s, href }: { s: Sym; href: string }): React.ReactElement => (
  <a className="api-row" href={href}>
    <code className="api-row-name">{s.qualifiedName}</code>
    <span className={`api-kind api-kind-${s.kind}`}>{s.kind}</span>
    <span className="api-row-sum">{firstSentence(plain(s.summary))}</span>
  </a>
);

export const ApiSymbolCard = ({ s }: { s: Sym }): React.ReactElement => {
  const sigs = s.signatures.length > 0 ? s.signatures : s.typeText !== undefined ? [s.typeText] : [];
  const lead = docLead(s.rawComment);
  const chips = [
    ...(s.category !== undefined ? [{ cls: "api-chip-cat", text: s.category }] : []),
    ...s.linkTargets.map((t) => ({ cls: "api-chip-link", text: t })),
  ];
  return (
    <article className="api-sym">
      <div className="api-sym-head">
        <code className="api-sym-name">{s.qualifiedName}</code>
        <span className={`api-kind api-kind-${s.kind}`}>{s.kind}</span>
        <span className="api-src">
          {s.source.file}:{s.source.line}
        </span>
      </div>
      {sigs.length > 0 ? (
        <div className="api-sig">{highlightToReact(sigs.join("\n"), "ts")}</div>
      ) : null}
      {lead ? <div className="api-doc">{renderJsdocToReact(lead)}</div> : null}
      {s.sourceText ? (
        <details className="api-source">
          <summary>
            Source <span className="api-src">{s.source.file}:{s.source.line}</span>
            <span className="api-source-lines">{s.sourceText.split("\n").length} lines</span>
          </summary>
          {/* line numbers start at the export's real file line, so `ln` counts from source.line - 1 */}
          <div className="api-source-code" style={{ "--ln-start": s.source.line - 1 }}>
            {highlightToReact(s.sourceText, "ts")}
          </div>
        </details>
      ) : null}
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
