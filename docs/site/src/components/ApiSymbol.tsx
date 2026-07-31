// Two views of one API symbol: a compact row for the namespace index (no Shiki — keeps those pages
// small) and the full card for its own page (checker-resolved signatures Shiki-highlighted, doc
// comment through the shared JSDoc renderer). loadHighlighter() must run before rendering a card.

import * as React from "react";
import type { ApiSource, ApiSymbol as Sym, ApiSymbolRow as Row } from "../lib/api-data.js";
import {
  highlightSourceWithHovers,
  highlightToReact,
  renderJsdocToReact,
} from "../lib/highlight.js";
import { declarationTypeLinks } from "../lib/api-source-links.js";
import { prerenderedHtml } from "../lib/inert-html.js";
import * as Router from "../ui/Router.js";

// The `file:line` location — a link to the line on GitHub when known, otherwise plain text. External
// packages get a shortened display path (e.g. `effect/Layer.ts`).
const displayFile = (file: string): string =>
  file.replace(/^repos\/effect\/packages\/effect\/src\//, "effect/");
const SrcRef = ({ source }: { source: ApiSource }): React.ReactElement => {
  const label = `${displayFile(source.file)}:${source.line}`;
  return source.url !== undefined ? (
    <a className="api-src" href={source.url} target="_blank" rel="noreferrer">
      {label}
    </a>
  ) : (
    <span className="api-src">{label}</span>
  );
};

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

export const ApiSymbolRow = ({ s, href }: { s: Row; href: string }): React.ReactElement => (
  <Router.Link
    className="api-row"
    to={href}
    data-kind={s.kind}
    title={s.qualifiedName}
  >
    <span className="api-row-head">
      <code className="api-row-name">{s.name}</code>
      <span className={`api-kind api-kind-${s.kind}`}>{s.kind}</span>
    </span>
    <span className="api-row-sum">{firstSentence(plain(s.summary))}</span>
  </Router.Link>
);

// The signature/type block, with every reference the compiler can prove linked to its page: the
// per-signature (or hover-parts) links realign onto the model's prettier-formatted strings and are
// displaced into the joined block's coordinates. A realign miss renders that line unlinked.
const SignatureBlock = ({
  s,
  sigs,
}: {
  s: Sym;
  sigs: ReadonlyArray<string>;
}): React.ReactElement => {
  const perSig = declarationTypeLinks(s.source.file, s.source.line, sigs) ?? [];
  const links: Array<{ start: number; end: number; url: string }> = [];
  let offset = 0;
  sigs.forEach((text, i) => {
    for (const link of perSig[i] ?? []) {
      links.push({
        start: link.start + offset,
        end: link.end + offset,
        url: link.url,
      });
    }
    offset += text.length + 1;
  });
  return (
    <div className="api-sig">
      {highlightToReact(sigs.join("\n"), "ts", links.length > 0 ? { links } : undefined)}
    </div>
  );
};

export const ApiSymbolCard = ({
  s,
  fileText,
  sourceHtml,
}: {
  s: Sym;
  fileText?: string; // the whole source file — provided (by the page) only for our own package
  sourceHtml?: string; // precomputed twoslash HTML — provided for effect-smol deps (gen-hovers)
}): React.ReactElement => {
  const sigs =
    s.signatures.length > 0 ? s.signatures : s.typeText !== undefined ? [s.typeText] : [];
  const lead = docLead(s.rawComment);
  const sourceLines = s.sourceText.split("\n").length;
  // Source panel, in preference order: precomputed twoslash HTML (effect-smol deps), a live twoslash
  // of the file text (our own package), else plain highlight.
  const sourceView =
    sourceHtml !== undefined
      ? prerenderedHtml({ className: "twoslash-precomputed" }, sourceHtml, "gen-hovers sidecar")
      : fileText !== undefined
      ? highlightSourceWithHovers(
          fileText,
          s.source.file,
          s.source.line,
          s.source.line + sourceLines - 1,
          s.docLinks
        ) ?? highlightToReact(s.sourceText, "ts")
      : highlightToReact(s.sourceText, "ts");
  // {@link} chips navigate when the compiler resolved the target (s.docLinks), else stay plain.
  const chips = [
    ...(s.category !== undefined
      ? [{ cls: "api-chip-cat", text: s.category, href: undefined as string | undefined }]
      : []),
    ...s.linkTargets.map((t) => ({ cls: "api-chip-link", text: t, href: s.docLinks[t] })),
  ];
  return (
    <>
      <article className="api-sym">
        <div className="api-sym-head">
          <code className="api-sym-name">{s.qualifiedName}</code>
          <span className={`api-kind api-kind-${s.kind}`}>{s.kind}</span>
          <SrcRef source={s.source} />
        </div>
        {sigs.length > 0 ? <SignatureBlock s={s} sigs={sigs} /> : null}
        {lead ? (
          <div className="api-doc">{renderJsdocToReact(lead, (t) => s.docLinks[t])}</div>
        ) : null}
        {chips.length > 0 ? (
          <div className="api-chips">
            {chips.map((c, i) =>
              c.href !== undefined ? (
                <Router.Link className={`api-chip ${c.cls}`} to={c.href} key={i}>
                  {c.text}
                </Router.Link>
              ) : (
                <span className={`api-chip ${c.cls}`} key={i}>
                  {c.text}
                </span>
              )
            )}
          </div>
        ) : null}
      </article>
      {s.sourceText ? (
        <section className="api-source">
          <div className="api-source-head">
            Source <SrcRef source={s.source} />
            <span className="api-source-lines">{s.sourceText.split("\n").length} lines</span>
          </div>
          {/* line numbers start at the export's real file line, so `ln` counts from source.line - 1 */}
          <div className="api-source-code" style={{ "--ln-start": s.source.line - 1 }}>
            {sourceView}
          </div>
        </section>
      ) : null}
    </>
  );
};
