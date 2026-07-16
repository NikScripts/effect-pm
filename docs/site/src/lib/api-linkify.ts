// Shared API-docgen link injection: turn identifier tokens inside twoslash hover popups into
// dotted-underline links to their doc pages. One implementation, two callers — the live render path
// (src/lib/highlight.ts, our own package's hovers) and the build-time precompute
// (scripts/gen-hovers.ts, the effect dependencies' hovers) — so both stay in sync.
/* eslint-disable @typescript-eslint/no-explicit-any -- HAST plumbing */

// Resolve an identifier (qualified `Namespace.export` first, then a bare name when unambiguous) to its
// doc-page URL, or undefined. Same shape as api-links.ts `resolveApiLink`.
export type ApiLinkResolver = (
  qualifiedName: string | undefined,
  name: string,
  allowBare: boolean,
) => string | undefined;

const IDENT = /^[A-Za-z_$][\w$]*$/;

export const classListOf = (n: any): string[] => {
  const c = n?.properties?.class;
  return Array.isArray(c) ? c : typeof c === "string" ? c.split(/\s+/) : [];
};

const findAllByClass = (node: any, cls: string, out: any[]): void => {
  if (!node || typeof node !== "object") return;
  if (classListOf(node).includes(cls)) out.push(node);
  for (const child of node.children ?? []) findAllByClass(child, cls, out);
};

// leaf token spans (a <span> whose only child is text), in document order, with parent + index so a
// match can be wrapped in-place without changing sibling positions.
const collectTokens = (
  node: any,
  out: Array<{ parent: any; idx: number; span: any; text: string }>,
): void => {
  const kids: any[] = node.children ?? [];
  for (let idx = 0; idx < kids.length; idx++) {
    const c = kids[idx];
    if (c?.type !== "element") continue;
    if (c.tagName === "span" && c.children?.length === 1 && c.children[0]?.type === "text") {
      out.push({ parent: node, idx, span: c, text: c.children[0].value });
    } else {
      collectTokens(c, out);
    }
  }
};

// Wrap every API-export identifier inside a hover popup's type-preview boxes (the compact "reg" type
// and the expanded "pretty" type) in a dotted-underline link to that symbol's doc page. `effect` types
// that aren't documented resolve to undefined and stay plain. Qualified `Namespace.export` resolves by
// qualified name; a bare name only when unambiguous and not itself a namespace qualifier.
export const linkApiTypes = (popupEl: any, resolve: ApiLinkResolver): void => {
  const boxes: any[] = [];
  findAllByClass(popupEl, "twoslash-popup-code", boxes); // covers the compact box AND the expand box
  for (const box of boxes) {
    const tokens: Array<{ parent: any; idx: number; span: any; text: string }> = [];
    collectTokens(box, tokens);
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      // shiki bakes surrounding whitespace into token text — match on the trimmed identifier
      const text = t.text.trim();
      if (!IDENT.test(text)) continue;
      // qualified `Namespace.export` when the two preceding tokens are `<ident>` `.`
      const prev = tokens[i - 1]?.text?.trim();
      const ns = tokens[i - 2]?.text?.trim();
      const qualifiedName =
        prev === "." && ns !== undefined && IDENT.test(ns) ? `${ns}.${text}` : undefined;
      // don't bare-match a token that's itself a qualifier (next token is `.`) — it's a namespace
      // (often an external one like `Schema`), not a standalone type reference
      const allowBare = tokens[i + 1]?.text?.trim() !== ".";
      const url = resolve(qualifiedName, text, allowBare);
      if (url === undefined) continue;
      t.parent.children[t.idx] = {
        type: "element",
        tagName: "a",
        properties: { class: "api-typelink", href: url },
        children: [t.span],
      };
    }
  }
};
