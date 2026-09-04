/**
 * Applies resolved doc links onto rendered code — the render-application half of the docgen (P3).
 * A {@link Link} is an offset range into a piece of display text (a source span, a printed type);
 * {@link transformer} wraps every shiki token that overlaps a range in an anchor, so the EXISTING
 * shiki/twoslash pipeline carries compiler-accurate links without a custom renderer (D1).
 *
 * Pure functions over data — no compiler, no services; the ranges come from the
 * {@link SourceRenderer} (source spans) or {@link fromParts} over the TypePrinter's output.
 *
 * @since 1.0.0
 */
import * as Option from "effect/Option";
import type { ShikiTransformer } from "shiki";
import type * as TypePrinter from "./TypePrinter.js";

/**
 * A doc link occupying `[start, end)` of the annotated text.
 *
 * @category models
 * @since 1.0.0
 */
export interface Link {
  readonly start: number;
  readonly end: number;
  readonly url: string;
}

/**
 * The linked ranges of a printed type — each linked {@link TypePrinter.Part} becomes a {@link Link}
 * at its offset in the concatenated part text.
 *
 * @category constructors
 * @since 1.0.0
 */
export const fromParts = (parts: ReadonlyArray<TypePrinter.Part>): ReadonlyArray<Link> => {
  const out: Array<Link> = [];
  let offset = 0;
  for (const part of parts) {
    Option.match(part.url, {
      onNone: () => {},
      onSome: (url) =>
        out.push({
          start: offset,
          end: offset + part.text.length,
          url,
        }),
    });
    offset += part.text.length;
  }
  return out;
};

// Characters a formatter may insert or drop without changing meaning — prettier adds/removes
// separators, parentheses, and quote styles, but never rewrites an identifier.
const elastic = /[;,()'"`]/;
const whitespace = /\s/;

/**
 * Remap links after the annotated text was reformatted (prettier line-breaking a long type): align
 * the two texts character-by-character, treating whitespace and separator punctuation as elastic.
 * None when the texts differ beyond formatting — a link that cannot be realigned exactly is not
 * worth guessing at (and a link whose own characters were dropped is skipped).
 *
 * @category combinators
 * @since 1.0.0
 */
export const realign = (
  links: ReadonlyArray<Link>,
  source: string,
  formatted: string
): Option.Option<ReadonlyArray<Link>> => {
  const map: Array<number | undefined> = new Array(source.length);
  let i = 0;
  let j = 0;
  while (i < source.length && j < formatted.length) {
    const a = source[i];
    const b = formatted[j];
    if (whitespace.test(a)) {
      i++;
      continue;
    }
    if (whitespace.test(b)) {
      j++;
      continue;
    }
    if (a === b) {
      map[i] = j;
      i++;
      j++;
      continue;
    }
    if (elastic.test(a)) {
      i++;
      continue;
    }
    if (elastic.test(b)) {
      j++;
      continue;
    }
    return Option.none();
  }
  for (; i < source.length; i++) {
    if (!whitespace.test(source[i]) && !elastic.test(source[i])) return Option.none();
  }
  const out: Array<Link> = [];
  for (const link of links) {
    const start = map[link.start];
    const last = map[link.end - 1];
    if (start === undefined || last === undefined) continue;
    out.push({
      start,
      end: last + 1,
      url: link.url,
    });
  }
  return Option.some(out);
};

/**
 * Options for {@link transformer}: the links to apply, how many characters precede the annotated
 * text in the code shiki actually renders (a twoslash preamble — subtracted from `token.offset`),
 * and the anchor class.
 *
 * @category models
 * @since 1.0.0
 */
export interface TransformerOptions {
  readonly links: ReadonlyArray<Link>;
  readonly shift?: number;
  readonly className?: string;
}

type HastElement = Parameters<NonNullable<ShikiTransformer["pre"]>>[0];
type HastChild = HastElement["children"][number];

// Temporary marker set at token time, resolved to an anchor in the late pass — never emitted.
const marker = "data-apilink";

const classTextOf = (node: HastElement): string => {
  const value = node.properties.class;
  return typeof value === "string" ? value : Array.isArray(value) ? value.join(" ") : "";
};

// Other transformers (twoslash) inject hover popups INSIDE the token element; those must stay
// outside the anchor or the whole popup becomes a click target.
const isPopup = (child: HastChild): boolean =>
  child.type === "element" && classTextOf(child).includes("twoslash-popup");

/**
 * A shiki transformer linking the annotated text's tokens: a token whose offset RANGE overlaps a
 * {@link Link} gets its visible content wrapped in an `<a>` inside the token span. A link spanning
 * several tokens (`Effect.Effect`) yields adjacent anchors to the same page.
 *
 * Two-phase on purpose: the `span` hook (token time) only STAMPS the element, and a late `pre`
 * pass wraps — after other transformers' surgery, so a twoslash hover popup injected inside the
 * token element stays OUTSIDE the anchor. List this transformer after twoslash.
 *
 * @category constructors
 * @since 1.0.0
 */
const containsPopup = (node: HastElement): boolean =>
  node.children.some(
    (child) => isPopup(child) || (child.type === "element" && containsPopup(child))
  );

const anchorInto = (node: HastElement, url: string, className: string): void => {
  const popups: Array<HastChild> = [];
  const linked: Array<HastChild> = [];
  for (const child of node.children) (isPopup(child) ? popups : linked).push(child);
  if (linked.length === 0) return;
  // A lone element child still holding a popup deeper down (twoslash's hover wrapper) — descend,
  // so the anchor ends up around the visible text only.
  const lone = linked.length === 1 && linked[0].type === "element" ? linked[0] : undefined;
  if (lone !== undefined && containsPopup(lone)) {
    anchorInto(lone, url, className);
    return;
  }
  node.children = [
    ...popups,
    {
      type: "element",
      tagName: "a",
      properties: {
        class: className,
        href: url,
      },
      children: linked,
    },
  ];
};

export const transformer = (options: TransformerOptions): ShikiTransformer => {
  const shift = options.shift ?? 0;
  const className = options.className ?? "api-typelink";
  const wrap = (node: HastElement): void => {
    for (const child of node.children) {
      if (child.type === "element") wrap(child);
    }
    const url = node.properties[marker];
    if (typeof url !== "string") return;
    delete node.properties[marker];
    anchorInto(node, url, className);
  };
  return {
    name: "docgen:links",
    span: (hast, _line, _col, _lineElement, token) => {
      const start = token.offset - shift;
      const end = start + token.content.length;
      const hit = options.links.find((link) => link.start < end && start < link.end);
      if (hit === undefined) return;
      hast.properties = {
        ...hast.properties,
        [marker]: hit.url,
      };
    },
    pre: (hast) => {
      wrap(hast);
    },
  };
};

// A leaf token: an element whose children are all text (shiki's token spans).
const isLeafToken = (node: HastElement): boolean =>
  node.children.length > 0 && node.children.every((child) => child.type === "text");

const textOf = (node: HastElement): string =>
  node.children.map((child) => (child.type === "text" ? child.value : "")).join("");

/**
 * Apply links to an ALREADY-rendered hast subtree by walking its visible text in document order —
 * for rendered text that never had source offsets (a hover popup's type box). Unlike the
 * render-time {@link transformer} (which anchors whole tokens), a leaf token's text is SPLIT at
 * the link boundaries, so a coarse token (`BackupMetadata, SqlError` as one span) yields an anchor
 * around exactly the linked run. `shift` is subtracted from the accumulated position (characters
 * preceding the annotated text, e.g. a declaration head).
 *
 * @category combinators
 * @since 1.0.0
 */
export const applyToHast = (root: HastElement, options: TransformerOptions): void => {
  const shift = options.shift ?? 0;
  const className = options.className ?? "api-typelink";
  let offset = 0;
  const visit = (node: HastElement): void => {
    for (const child of node.children) {
      if (child.type === "text") {
        offset += child.value.length;
        continue;
      }
      if (child.type !== "element") continue;
      if (isPopup(child)) continue; // hidden content — not part of the visible text
      if (isLeafToken(child)) {
        const text = textOf(child);
        const start = offset - shift;
        const end = start + text.length;
        offset += text.length;
        const hit = options.links.find((link) => link.start < end && start < link.end);
        if (hit === undefined) continue;
        const from = Math.max(0, hit.start - start);
        const to = Math.min(text.length, hit.end - start);
        child.children = [
          ...(from > 0
            ? [
                {
                  type: "text" as const,
                  value: text.slice(0, from),
                },
              ]
            : []),
          {
            type: "element" as const,
            tagName: "a",
            properties: {
              class: className,
              href: hit.url,
            },
            children: [
              {
                type: "text" as const,
                value: text.slice(from, to),
              },
            ],
          },
          ...(to < text.length
            ? [
                {
                  type: "text" as const,
                  value: text.slice(to),
                },
              ]
            : []),
        ];
        continue;
      }
      visit(child);
    }
  };
  visit(root);
};
