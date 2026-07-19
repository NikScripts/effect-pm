/**
 * Applies resolved doc links onto rendered code — the render-application half of the docgen (P3).
 * A {@link Link} is an offset range into a piece of display text (a source span, a printed type);
 * {@link transformer} turns every shiki token that overlaps a range into an anchor, so the EXISTING
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

const appendClass = (existing: unknown, added: string): string =>
  typeof existing === "string" && existing !== ""
    ? `${existing} ${added}`
    : Array.isArray(existing)
    ? [...existing, added].join(" ")
    : added;

/**
 * A shiki transformer linking the annotated text's tokens: a token whose offset RANGE overlaps a
 * {@link Link} becomes an `<a>` (kept as the token element — style and children intact). A link
 * spanning several tokens (`Effect.Effect`) yields adjacent anchors to the same page.
 *
 * @category constructors
 * @since 1.0.0
 */
export const transformer = (options: TransformerOptions): ShikiTransformer => {
  const shift = options.shift ?? 0;
  const className = options.className ?? "api-typelink";
  return {
    name: "docgen:links",
    span: (hast, _line, _col, _lineElement, token) => {
      const start = token.offset - shift;
      const end = start + token.content.length;
      const hit = options.links.find((link) => link.start < end && start < link.end);
      if (hit === undefined) return;
      hast.tagName = "a";
      hast.properties = {
        ...hast.properties,
        class: appendClass(hast.properties.class, className),
        href: hit.url,
      };
    },
  };
};
