// Server-side syntax highlighting with Shiki.
//
// Shiki highlights at render time (dev) / build time (SSG) — no client JS ships, the
// coloured markup is baked into the static HTML. Output is dual-theme (github-light +
// github-dark); docs.css switches tokens under `prefers-color-scheme: dark`.
//
// We render Shiki's HAST as real React elements. The ONE exception is the inert popup template
// content, which crosses the single sanctioned boundary in src/lib/inert-html.tsx (see there).

import { fileURLToPath } from "node:url";
import * as React from "react";
import * as ts from "typescript";
import { createHighlighter, type Highlighter } from "shiki";
import { createTransformerFactory, rendererRich } from "@shikijs/twoslash";
import { createTwoslasher } from "twoslash";
import { fromMarkdown } from "mdast-util-from-markdown";
import { toHast } from "mdast-util-to-hast";
import prettier from "prettier";
import * as Option from "effect/Option";
import { makeTypeExpander } from "./expandType";
import { docLinksByLocation } from "./api-data";
import {
  loadSourceLinks,
  packageSourcePaths,
  sourceLinksFor,
  symbolIndexEntries,
} from "./api-source-links";
import * as Annotate from "@nikscripts/docgen/Annotate";
import { inertTemplate } from "./inert-html.js";
import { runServer } from "./runtime";

// Compiler-resolved {@link} maps, keyed by a symbol's declaration `file:line` (see gen-api). Hovers
// look up the hovered symbol's location here to link the same as the pages do. Populated by
// loadHighlighter (via effect/FileSystem), so the sync render pipeline just reads it.
let hoverDocLinks: Readonly<Record<string, Record<string, string>>> = {};
// When rendering the source panel we KNOW the owner symbol (the page's), so pass its resolved links
// directly — the source is compiled inline, so its local symbols have no real location to key on.
let currentOwnerDocLinks: Record<string, string> | undefined;
// Rewrite {@link X} -> {@link <url>|X} for targets we resolved, so the doc renderer links them
// (resolveDocRef treats a "/"-prefixed target as an already-resolved url).
const embedDocLinks = (docs: string, links: Record<string, string>): string =>
  docs.replace(/\{@link\s+([^}|\s]+)[^}]*\}/g, (m, target: string) => {
    const url = links[target.trim()];
    return url !== undefined ? `{@link ${url}|${target.trim()}}` : m;
  });

const THEMES = { light: "github-light", dark: "github-dark" } as const;
const LOAD_LANGS = ["typescript", "tsx", "bash", "json"] as const;
const ALIAS: Record<string, string> = {
  ts: "typescript",
  typescript: "typescript",
  tsx: "tsx",
  sh: "bash",
  bash: "bash",
  shell: "bash",
  json: "json",
};

// Twoslash type-checks each opted-in block against OUR types. Omitting `fsMap` makes it read the
// real filesystem (rooted at the repo), so `effect` resolves from node_modules; `paths` maps the
// package name to its source so `hyperlink-ts/*` → `src/*`.
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const compilerOptions: ts.CompilerOptions = {
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  skipLibCheck: true,
  types: [],
  allowImportingTsExtensions: true, // effect-smol source imports with explicit `.ts` — so the same
  noEmit: true, // twoslasher renders both our package (extension-less) and effect deps (gen-hovers);
  baseUrl: repoRoot, // noEmit is required alongside allowImportingTsExtensions (twoslash never emits)
  paths: {
    "hyperlink-ts": ["src/index.ts"],
    "hyperlink-ts/*": ["src/*"],
  },
};

// Map a twoslash node offset (in the trimmed/visible code) back to the full-code offset (the code
// twoslash was given, `---cut---` preamble included), so our expander's checker points at the right
// node. `removals` are ranges removed from the full code to produce the visible output.
const toFullOffset = (
  visible: number,
  removals: ReadonlyArray<readonly [number, number]>
): number => {
  let full = visible;
  for (const [s, e] of [...removals].sort((a, b) => a[0] - b[0])) {
    if (s <= full) full += e - s;
  }
  return full;
};

// The "dual preview": every hover popover carries its compact type (twoslash's `node.text`) AND, in a
// SEPARATE box below, the compiler-API-expanded declaration (`const emails: { …members… }`). We stash
// the expansion in `node.docs` behind a sentinel and a custom `renderMarkdown` (below) turns it into a
// highlighted code box. Best-effort: any failure just drops the expansion, never the page.
const baseTwoslasher = createTwoslasher({ vfsRoot: repoRoot, compilerOptions });
const expandTypes = makeTypeExpander({
  compilerOptions,
  vfsRoot: repoRoot,
  // The docgen location index — loaded by loadHighlighter (via loadSourceLinks), read lazily here.
  getLocations: symbolIndexEntries,
  // Resolve `effect`/`@effect/*` to the DOCUMENTED source inside the expander only, so guide
  // example hovers land on declarations the index knows (twoslash keeps the runtime deps).
  getPaths: packageSourcePaths,
});

// Zero-guess popup links: per hover node, OUR compiler-printed type links REALIGNED onto the
// displayed (formatted) hover text — in box coordinates, applied to the popup's compact code box
// (and the expand box) by the renderer below. Absent when the texts genuinely differ.
const hoverPopupLinks = new WeakMap<object, ReadonlyArray<Annotate.Link>>();
const hoverExpandLinks = new WeakMap<object, ReadonlyArray<Annotate.Link>>();
// Substituting the displayed body with our print only makes sense for plain declaration heads
// (`const emails: `, `SqliteClient.backup: `) — a method-call head (`take(self: …): `) trips the
// lazy head regex, and a pathological type would blow up the popup.
// A substitutable declaration head: keyword + (possibly generic-qualified) name + `: `.
// `WorkPool<{ to: string; }>.add: ` qualifies (brackets balance, junk only inside them);
// `H.add(item: Email): ` does NOT — a depth-zero `(` marks a callable head, which the
// callableForm path owns (substituting a head that already spells the params would double them).
const isSimpleHead = (head: string): boolean => {
  const m = /^(?:(?:const|let|var|type|interface|class|namespace|enum)\s+)?([\s\S]+?)\??:\s$/.exec(
    head
  );
  if (m === null || m[1] === undefined) return false;
  let depth = 0;
  for (const c of m[1]) {
    if (c === "(" && depth === 0) return false;
    if (c === "(" || c === "[" || c === "{" || c === "<") depth += 1;
    else if (c === ")" || c === "]" || c === "}" || c === ">") depth -= 1;
    else if (depth === 0 && !/[\w$.]/.test(c)) return false;
  }
  return depth === 0;
};
const maxSubstituteLength = 2000;

// Callable hovers (`(method) H.add(item: Email): Effect<…>`, `function retry(...): …`) have no
// simple head — their first `:` sits inside the parameter list, so neither substitution nor
// realign ever landed and method popups stayed link-less. But the compiler print exists at those
// sites in ARROW form; method form is the same text with the top-level ` => ` seam replaced by
// `: `, so links carry over by pure displacement.
const callableHead = /^((?:function\s+)?[\w$.]+)(?=[(<])/;

// Index of the top-level ` => ` in a printed type — depth-tracked so arrows nested in parameter
// or generic positions don't match; `=>`'s own `>` must not count against depth.
const topLevelArrow = (text: string): number => {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (depth === 0 && text.startsWith(" => ", i)) return i;
    if (text.startsWith("=>", i)) {
      i += 1;
      continue;
    }
    const c = text[i];
    if (c === "(" || c === "[" || c === "{" || c === "<") depth += 1;
    else if (c === ")" || c === "]" || c === "}" || c === ">") depth -= 1;
  }
  return -1;
};

interface CallableForm {
  readonly text: string;
  readonly links: ReadonlyArray<Annotate.Link>;
}

const callableForm = (
  name: string,
  typeText: string,
  typeLinks: ReadonlyArray<Annotate.Link>
): CallableForm | undefined => {
  const arrow = topLevelArrow(typeText);
  if (arrow < 0) return undefined;
  const shift = (p: number): number => (p < arrow ? p + name.length : p + name.length - 2);
  return {
    text: `${name}${typeText.slice(0, arrow)}: ${typeText.slice(arrow + 4)}`,
    links: typeLinks
      .filter((l) => l.end <= arrow || l.start >= arrow + 4)
      .map((l) => ({
        start: shift(l.start),
        end: shift(l.end),
        url: l.url,
      })),
  };
};
// The declaration NAME at the start of a (prefix-stripped) hover text — declaration keywords are
// skipped, so `type Protocol = …` yields `Protocol`.
const declName =
  /^(?:(?:import|export|declare|const|let|var|function|class|interface|type|namespace|enum|abstract|new)\s+)*([\w$.]+)/;

// Sentinel wrapping our expansion inside `node.docs` (a field that survives to the renderer, unlike
// arbitrary props). The renderer splits it off and wedges it as its own box between the type and the
// real JSDoc comments.
const EXPAND_OPEN = "@@PMEXPAND@@";

// The declaration head of a hover — `const emails: WorkPool<…>` → `const emails: ` (everything
// up to the type), so the expanded box reads as the same declaration with the body spelled out.
// DEPTH-AWARE: a generic-qualified head (`WorkPool<{ to: string; }>.add: …`) has colons inside
// the type arguments; the head's colon is the first one at bracket depth zero.
const declHead = (text: string): string => {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (depth === 0 && text[i] === ":" && text[i + 1] === " ") return text.slice(0, i + 2);
    if (text.startsWith("=>", i)) {
      i += 1;
      continue;
    }
    const c = text[i];
    if (c === "(" || c === "[" || c === "{" || c === "<") depth += 1;
    else if (c === ")" || c === "]" || c === "}" || c === ">") depth -= 1;
  }
  return "";
};

// Prettier-format a hover's compact type so long generics break across lines in the popup instead of
// stretching off-screen. Twoslash prefixes some hovers with "(property) " / "(method) " etc. — keep
// that; wrap the rest in a valid TS construct, format, and unwrap. Best-effort: unparseable text is
// returned unchanged. Narrow printWidth because the popup is narrow.
const hoverFormatOpts = { parser: "typescript" as const, printWidth: 50, semi: false };
const tryFormat = (src: string, unwrap: (s: string) => string): string | undefined => {
  try {
    return unwrap(prettier.format(src, hoverFormatOpts).trim());
  } catch {
    return undefined;
  }
};
const formatHoverType = (text: string): string => {
  const m = /^(\([a-z ]+\)\s+)?([\s\S]+)$/.exec(text);
  const prefix = m?.[1] ?? "";
  const body = (m?.[2] ?? text).trim();
  // `name: Type` / `name?: Type` (a property or variable) — format only the type after the colon.
  const decl = /^([\w$]+\??:\s*)([\s\S]+)$/.exec(body);
  if (decl !== null) {
    const t = tryFormat(`type _t = ${decl[2]}`, (s) =>
      s
        .replace(/^type _t =\s*/, "")
        .replace(/;$/, "")
        .trim()
    );
    if (t !== undefined) return `${prefix}${decl[1]}${t}`;
  }
  // a full declaration (const / function / class / type …)
  const full = tryFormat(`declare ${body}`, (s) =>
    s
      .replace(/^declare\s+/, "")
      .replace(/;$/, "")
      .trim()
  );
  if (full !== undefined) return prefix + full;
  // a bare type
  const bare = tryFormat(`type _t = ${body}`, (s) =>
    s
      .replace(/^type _t =\s*/, "")
      .replace(/;$/, "")
      .trim()
  );
  if (bare !== undefined) return prefix + bare;
  return text;
};

// Cache per-block hover info (expanded type + owner location) — dev re-renders the same block often.
const blockCache = new Map<string, ReturnType<typeof expandTypes>>();

// In-code links for twoslash blocks WITHOUT precomputed source links (guide snippets): each hover
// whose symbol owns a page contributes its token range. One STABLE array — the Annotate
// transformer captures it before the render and reads it lazily at span time, and the twoslasher
// (which runs first, in preprocessing) clears + refills it per render. Renders are synchronous,
// so the instance is never shared across two in-flight blocks.
const hoverCodeLinks: Array<Annotate.Link> = [];

const twoslasher = Object.assign(
  (
    code: string,
    extension: Parameters<typeof baseTwoslasher>[1],
    options: Parameters<typeof baseTwoslasher>[2]
  ): ReturnType<typeof baseTwoslasher> => {
    const result = baseTwoslasher(code, extension, options);
    hoverCodeLinks.length = 0;
    try {
      const hovers = result.nodes.filter(
        (n): n is typeof n & { text: string; start: number; docs?: string } =>
          n.type === "hover" || n.type === "query"
      );
      if (hovers.length === 0) return result;
      const removals = result.meta.removals as ReadonlyArray<readonly [number, number]>;
      const offsets = hovers.map((h) => toFullOffset(h.start, removals));
      let expansions = blockCache.get(code);
      if (!expansions) {
        expansions = expandTypes(code, offsets);
        blockCache.set(code, expansions);
      }
      hovers.forEach((h, i) => {
        const info = expansions!.get(offsets[i]);
        // In-code anchor for the hovered token (guides have no precomputed source links): the
        // hovered symbol's own page, same zero-guess resolution the popup name-link uses.
        if (info?.ownerUrl !== undefined && typeof h.length === "number") {
          hoverCodeLinks.push({
            start: h.start,
            end: h.start + h.length,
            url: info.ownerUrl,
          });
        }
        // Embed compiler-resolved {@link} urls into the docs. Source panel: the owner is the page's
        // symbol (currentOwnerDocLinks). Doc blocks: an imported symbol resolves to its real
        // location (ownerLoc) in the shared doc-links map.
        if (h.docs !== undefined) {
          const links =
            currentOwnerDocLinks ??
            (info?.ownerLoc !== undefined ? hoverDocLinks[info.ownerLoc] : undefined);
          if (links !== undefined) h.docs = embedDocLinks(h.docs, links);
        }
        // Dual-preview expand box (existing), now with compiler links on the member types.
        const expanded = info?.expanded;
        if (expanded === undefined) return;
        let head = declHead(h.text);
        if (head) {
          // Skip when the hover already shows the shape inline (its type is an object literal).
          if (h.text.slice(head.length).trimStart().startsWith("{")) return;
        } else {
          // Class hovers are headless (`class Random`) — synthesize the head so SERVICE CLASSES
          // get a pretty preview too: `class Random { Service: …; key: … }` (phantom members are
          // filtered by the expander). Other headless hovers (bare type names) stay box-less.
          const cls = /^(?:\([a-z ]+\)\s+)?(class\s+[\w$.]+)/.exec(h.text);
          if (cls === null || cls[1] === undefined) return;
          head = `${cls[1]} `;
        }
        const prior = h.docs;
        h.docs = `${prior ? `${prior}\n` : ""}${EXPAND_OPEN}${head}${expanded}`;
        // The expand box displays `head + expanded` verbatim: the declaration name in the head
        // links to the hover's own page (mobile parity with the compact box), and the member-type
        // links displace by the head.
        const expandBoxLinks: Array<Annotate.Link> = [];
        if (info?.ownerUrl !== undefined) {
          const name = declName.exec(head);
          if (name !== null && name[1] !== undefined) {
            const start = name[0].length - name[1].length;
            expandBoxLinks.push({
              start,
              end: start + name[1].length,
              url: info.ownerUrl,
            });
          }
        }
        for (const link of info?.expandedLinks ?? []) {
          expandBoxLinks.push({
            start: link.start + head.length,
            end: link.end + head.length,
            url: link.url,
          });
        }
        if (expandBoxLinks.length > 0) hoverExpandLinks.set(h, expandBoxLinks);
      });
      // Format each hover's compact type AFTER expansion (which reads the raw text) so long types
      // break across lines in the popup — then realign OUR link ranges onto the formatted text.
      hovers.forEach((h, i) => {
        const info = expansions!.get(offsets[i]);
        // FULL CAPTURE: when the hover has a simple declaration head and we printed its type, the
        // displayed body BECOMES our compiler print — realign over our own formatting then always
        // lands, so every reference in the compact box links. Headless hovers (imports, bare type
        // names) and method-call heads keep twoslash's text with best-effort realign.
        // What realign works against below: the compiler print (source coordinates + links) and
        // the head to skip in the displayed text. Callable substitution replaces both.
        let subText = info?.typeText;
        let subLinks = info?.typeLinks;
        let subHeadless = false;
        if (info?.typeText !== undefined && info.typeText.length <= maxSubstituteLength) {
          const m0 = /^(\([a-z ]+\)\s+)?([\s\S]+)$/.exec(h.text);
          const prefix0 = m0?.[1] ?? "";
          const rest0 = m0?.[2] ?? h.text;
          const head0 = declHead(rest0);
          if (isSimpleHead(head0)) {
            h.text = `${prefix0}${head0}${info.typeText}`;
          } else {
            const callable = callableHead.exec(rest0);
            if (callable !== null && callable[1] !== undefined && info.typeLinks !== undefined) {
              const form = callableForm(callable[1], info.typeText, info.typeLinks);
              if (form !== undefined) {
                h.text = `${prefix0}${form.text}`;
                subText = form.text;
                subLinks = form.links;
                subHeadless = true;
              }
            }
          }
        }
        h.text = formatHoverType(h.text);
        // Box coordinates: rendererRich strips the "(property) " prefix from the displayed box.
        const m = /^(\([a-z ]+\)\s+)?([\s\S]+)$/.exec(h.text);
        const rest = m?.[2] ?? h.text;
        const popupLinks: Array<Annotate.Link> = [];
        // The hovered symbol's OWN page, linked on the declaration NAME in the box head — on touch
        // devices the in-code anchor is inert (the tap opens the preview), so this is the mobile
        // navigation path: `type Protocol = …` links `Protocol`.
        if (info?.ownerUrl !== undefined) {
          const name = declName.exec(rest);
          if (name !== null && name[1] !== undefined) {
            const start = name[0].length - name[1].length;
            popupLinks.push({
              start,
              end: start + name[1].length,
              url: info.ownerUrl,
            });
          }
        }
        // Our parts print the TYPE (the body after the declaration head) — realign onto it, then
        // displace into box coordinates. Callable forms have no head: the whole rest IS our print.
        if (subText !== undefined && subLinks !== undefined) {
          const head = subHeadless ? "" : declHead(rest);
          const body = rest.slice(head.length);
          const displace = head.length;
          Option.match(Annotate.realign(subLinks, subText, body), {
            onNone: () => {},
            onSome: (links) => {
              for (const link of links) {
                popupLinks.push({
                  start: link.start + displace,
                  end: link.end + displace,
                  url: link.url,
                });
              }
            },
          });
        }
        if (popupLinks.length > 0) hoverPopupLinks.set(h, popupLinks);
      });
    } catch {
      // Expansion is best-effort: on any failure keep the plain (compact) twoslash hovers.
    }
    return result;
  },
  // A `TwoslashInstance` is callable + carries a `getCacheMap`; reuse the base instance's.
  { getCacheMap: baseTwoslasher.getCacheMap }
);

// HAST helpers to splice the expanded box into the popup, and a renderer that inserts it BETWEEN the
// compact type box and the JSDoc-comments box.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- HAST plumbing
const classListOf = (n: any): string[] => {
  const c = n?.properties?.class;
  return Array.isArray(c) ? c : typeof c === "string" ? c.split(/\s+/) : [];
};
// find the first descendant with a class
const findByClass = (node: any, cls: string): any => {
  if (!node || typeof node !== "object") return undefined;
  if (classListOf(node).includes(cls)) return node;
  for (const child of node.children ?? []) {
    const found = findByClass(child, cls);
    if (found) return found;
  }
  return undefined;
};
function insertExpand(this: any, hoverEl: any, code: string): void {
  const popup = findByClass(hoverEl, "twoslash-popup-container");
  const kids: any[] | undefined = popup?.children;
  if (!kids) return;
  const box = {
    type: "element",
    tagName: "code",
    properties: { class: "twoslash-popup-code twoslash-popup-expand" },
    children: this.codeToHast(code, {
      ...this.options,
      meta: {},
      transformers: [],
      lang: "ts",
      structure: "classic",
    }).children,
  };
  const at = kids.findIndex((c) => classListOf(c).includes("twoslash-popup-code"));
  kids.splice(at >= 0 ? at + 1 : kids.length, 0, box);
}
// Pull our sentinel'd expansion out of `info.docs`, restoring the real JSDoc so the base renderer
// only shows genuine comments; returns the expansion code (or undefined).
function splitExpand(info: any): string | undefined {
  const docs: string | undefined = info?.docs;
  if (!docs || !docs.includes(EXPAND_OPEN)) return undefined;
  const at = docs.indexOf(EXPAND_OPEN);
  const real = docs.slice(0, at).trim();
  info.docs = real || undefined;
  return docs.slice(at + EXPAND_OPEN.length);
}
// Minimal JSDoc-markdown renderer for the comments box: fenced code blocks are syntax-highlighted,
// inline `code` becomes <code>, and blank lines split paragraphs. (rendererRich's default dumps the
// raw markdown text, so ``` fences and `code` showed as literal characters.)
// JSDoc comments ARE markdown. Parse them properly (bold / italic / lists / headings / links / code)
// with mdast, and hand fenced code to shiki so it stays highlighted (mdast alone leaves it plain).
// `{@link Target}` / `{@link Target text}` — which mdast doesn't understand — are pre-rewritten to a
// markdown link with a sentinel `@link:` URL, so mdast parses them as inline links; the `link` handler
// below turns that sentinel into a non-navigating blue reference (we can't resolve targets to real
// URLs in the popup, so it's styled, not clickable). The visible label is just the target (or custom
// text) — NO `@link` prefix, else references inside `@see` tags read as "@see @link Foo".
function preprocessJsdoc(md: string): string {
  const label = (target: string, text: string) =>
    `[${text.trim() || target.trim()}](@link:${target.trim()})`;
  // One tolerant matcher for {@link Target}, {@link Target text}, {@link Target|text}, and any of
  // those with stray inner whitespace (e.g. `{@link httpServer }`) — the separator and trailing
  // space are optional, so a bare target with a trailing space no longer leaks raw.
  return md.replace(/\{@link\s+([^}|\s]+)(?:\s*\|\s*|\s+)?([^}]*?)\s*\}/g, (_m, target, text) =>
    label(String(target), String(text ?? ""))
  );
}

// Link API export names that appear inside inline `code` spans in JSDoc — the monospaced bits
// only, never plain prose. ZERO-GUESS: names resolve ONLY through the owner symbol's
// compiler-resolved {@link} map (`resolveLink`) — the checker resolved those targets in the
// declaration's own scope, so a match is exact; there is no global name bucket to guess from.
const API_REF = /[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?/g;
// Split inline-code text into HAST, wrapping any resolvable API-export name in a doc link.
const linkifyCode = (text: string, resolveLink?: (target: string) => string | undefined): any[] => {
  const out: any[] = [];
  let last = 0;
  for (const m of text.matchAll(API_REF)) {
    const tok = m[0];
    const at = m.index ?? 0;
    const url = resolveLink?.(tok);
    if (url === undefined) continue;
    if (at > last) out.push({ type: "text", value: text.slice(last, at) });
    out.push({
      type: "element",
      tagName: "a",
      properties: { class: "api-typelink", href: url },
      children: [{ type: "text", value: tok }],
    });
    last = at + tok.length;
  }
  if (out.length === 0) return [{ type: "text", value: text }];
  if (last < text.length) out.push({ type: "text", value: text.slice(last) });
  return out;
};

// `this`-free so the same renderer serves both the twoslash hover popups and the API-reference pages;
// fenced code uses the shared highlighter directly (loadHighlighter must have run first).
function jsdocToHast(docs: string, resolveLink?: (target: string) => string | undefined): any[] {
  const tree = fromMarkdown(preprocessJsdoc(docs));
  const root: any = toHast(tree, {
    handlers: {
      // fenced code block -> shiki-highlighted, wrapped in our styled container
      code: (_state: any, node: any) => {
        const lang = (node.lang && ALIAS[String(node.lang).toLowerCase()]) || "typescript";
        let children: any[];
        try {
          if (!hl) throw new Error("highlighter not loaded");
          children = hl.codeToHast(String(node.value), {
            themes: THEMES,
            meta: {},
            transformers: [],
            lang,
            structure: "classic",
          }).children;
        } catch {
          children = [
            {
              type: "element",
              tagName: "pre",
              properties: {},
              children: [{ type: "text", value: String(node.value) }],
            },
          ];
        }
        return {
          type: "element",
          tagName: "div",
          properties: { className: ["twoslash-popup-docs-code"] },
          children,
        };
      },
      // inline `code` -> a <code>, with any API-export name inside it turned into a doc link when
      // the owner's compiler-resolved map knows it. Only the monospaced content is scanned; plain
      // prose is never touched.
      inlineCode: (_state: any, node: any) => ({
        type: "element",
        tagName: "code",
        properties: {},
        children: linkifyCode(String(node.value), resolveLink),
      }),
      // `{@link …}` (rewritten to an `@link:` sentinel URL above) -> a REAL link when the target
      // resolves to an API symbol, otherwise a styled, non-navigating reference. Real markdown links
      // keep their <a> and open in a new tab.
      link: (state: any, node: any) => {
        const children = state.all(node);
        const url = typeof node.url === "string" ? node.url : "";
        if (url.startsWith("@link:")) {
          // Already-resolved urls (embedded by embedDocLinks) pass through; otherwise ONLY the
          // caller's compiler-resolved map answers — an unresolved target renders styled, unlinked.
          const target = url.slice("@link:".length).trim();
          const resolved = target.startsWith("/") ? target : resolveLink?.(target);
          return resolved !== undefined
            ? {
                type: "element",
                tagName: "a",
                properties: { className: ["twoslash-jsdoc-link"], href: resolved },
                children,
              }
            : {
                type: "element",
                tagName: "span",
                properties: { className: ["twoslash-jsdoc-link"] },
                children,
              };
        }
        return {
          type: "element",
          tagName: "a",
          properties: { href: url, target: "_blank", rel: ["noreferrer"] },
          children,
        };
      },
    },
  });
  return root?.children ?? [];
}
function renderJsdocMarkdown(docs: string): any[] {
  return jsdocToHast(docs);
}
// Inline context (JSDoc @tag values): parse the same way, but unwrap a lone paragraph so a one-line
// value (e.g. `@since 4.0.0`) doesn't become a block.
function renderJsdocInline(text: string): any[] {
  const hast = jsdocToHast(text);
  if (hast.length === 1 && hast[0]?.tagName === "p") return hast[0].children;
  return hast;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- HAST renderer plumbing
const baseRenderer: any = rendererRich({
  renderMarkdown: renderJsdocMarkdown as never,
  renderMarkdownInline: renderJsdocInline as never,
});
// INERT the popup: wrap the popup container in a <template>, so the megabytes of hidden popup
// markup parse into inert document fragments instead of live DOM (style/layout cost collapses on
// hover-dense pages). The TwoslashHover island materializes a popup on first open — content is
// already local, so hover latency stays zero.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- HAST plumbing
const inertPopup = (el: any): void => {
  if (!el || typeof el !== "object") return;
  const kids: any[] = el.children ?? [];
  const at = kids.findIndex((c: any) => classListOf(c).includes("twoslash-popup-container"));
  if (at >= 0) {
    kids[at] = {
      type: "element",
      tagName: "template",
      properties: { class: "twoslash-popups" },
      children: [kids[at]],
    };
    return;
  }
  for (const c of kids) inertPopup(c);
};

// Apply the hover's realigned compiler links onto the popup's compact type box (the first
// twoslash-popup-code — the expand box comes after it and stays unlinked for now).
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- HAST plumbing
const applyPopupLinks = (info: any, el: any): void => {
  const links = hoverPopupLinks.get(info);
  if (links !== undefined) {
    const box = findByClass(el, "twoslash-popup-code");
    if (box !== undefined) Annotate.applyToHast(box, { links });
  }
  const expandLinks = hoverExpandLinks.get(info);
  if (expandLinks !== undefined) {
    const box = findByClass(el, "twoslash-popup-expand");
    if (box !== undefined) Annotate.applyToHast(box, { links: expandLinks });
  }
};
const renderer = {
  ...baseRenderer,
  nodeStaticInfo(this: any, info: any, node: any) {
    const code = splitExpand(info);
    const el = baseRenderer.nodeStaticInfo.call(this, info, node);
    if (code)
      try {
        insertExpand.call(this, el, code);
      } catch {
        /* keep plain popup */
      }
    try {
      applyPopupLinks(info, el);
    } catch {
      /* links are best-effort */
    }
    try {
      inertPopup(el);
    } catch {
      /* inertness is an optimization, never required */
    }
    return el;
  },
  nodeQuery(this: any, info: any, node: any) {
    const code = splitExpand(info);
    const el = baseRenderer.nodeQuery.call(this, info, node);
    if (code)
      try {
        insertExpand.call(this, el, code);
      } catch {
        /* keep plain popup */
      }
    try {
      applyPopupLinks(info, el);
    } catch {
      /* links are best-effort */
    }
    try {
      inertPopup(el);
    } catch {
      /* inertness is an optimization, never required */
    }
    return el;
  },
};
const twoslash = createTransformerFactory(twoslasher, renderer as never)({});

let hl: Highlighter | undefined;

/** Load the shared highlighter + the link data once, before the (sync) render walk. */
export const loadHighlighter = async (): Promise<void> => {
  if (!hl) {
    hl = await createHighlighter({
      themes: [THEMES.light, THEMES.dark],
      langs: [...LOAD_LANGS],
    });
  }
  hoverDocLinks = await runServer(docLinksByLocation());
  await loadSourceLinks();
};

// HTML attribute → React prop name for the few twoslash emits that React is strict about.
const ATTR_RENAME: Record<string, string> = {
  tabindex: "tabIndex",
  for: "htmlFor",
  colspan: "colSpan",
  rowspan: "rowSpan",
};

let keySeq = 0;

const toStyle = (raw?: string): React.CSSProperties | undefined => {
  if (!raw) return undefined;
  const style: Record<string, string> = {};
  for (const decl of raw.split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim();
    const value = decl.slice(i + 1).trim();
    if (!prop) continue;
    // keep CSS custom props (--shiki-dark) verbatim; camelCase the rest for React
    style[prop.startsWith("--") ? prop : prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] =
      value;
  }
  return style as React.CSSProperties;
};

const hastToReact = (node: any): React.ReactNode => {
  if (node.type === "text") return node.value;
  if (node.type === "root") return node.children.map(hastToReact);
  const p = node.properties ?? {};
  // Carry through every property — twoslash emits `data-*` + nested popover nodes that must reach
  // the DOM for hover to work; `class`/`style` need React name/format massaging, and a few HTML
  // attributes need their React camelCase names (`data-*`/`aria-*` pass through verbatim).
  const props: Record<string, unknown> = { key: keySeq++ };
  for (const [k, v] of Object.entries(p)) {
    if (k === "class" || k === "className") props.className = Array.isArray(v) ? v.join(" ") : v;
    else if (k === "style") props.style = toStyle(v as string);
    else props[ATTR_RENAME[k] ?? k] = Array.isArray(v) ? v.join(" ") : v;
  }
  // Inert popup templates cross the ONE sanctioned inner-HTML boundary (src/lib/inert-html.tsx —
  // rationale and safety checks live there): React-rendered template CHILDREN hydrate as a
  // guaranteed mismatch, which regenerated whole pages client-side and killed mobile taps.
  if (node.tagName === "template") return inertTemplate(props, node.children ?? []);
  return React.createElement(node.tagName, props, (node.children ?? []).map(hastToReact));
};

/** Highlight a code block to Shiki HAST with our full hover pipeline (dual-preview expand,
 *  markdown-rendered JSDoc, api-typelinks). `twoslash` runs the TS language service for hover types.
 *  Returns undefined for an unknown language / before the highlighter loads. Used by the live React
 *  render (below) and by the build-time hover precompute (scripts/gen-hovers.ts), so both share ONE
 *  rendering. `loadHighlighter()` must have run first. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- HAST plumbing
export const highlightToHast = (
  code: string,
  lang?: string,
  opts?: {
    readonly twoslash?: boolean;
    /** Compiler-resolved source links (docgen Annotate ranges, relative to the VISIBLE code). */
    readonly links?: ReadonlyArray<Annotate.Link>;
  }
): any | undefined => {
  const text = code.replace(/\n$/, "");
  const resolved = lang ? ALIAS[lang.toLowerCase()] : undefined;
  if (!hl || !resolved) return undefined;
  return hl.codeToHast(text, {
    lang: resolved,
    themes: THEMES,
    transformers: [
      ...(opts?.twoslash ? [twoslash] : []),
      // Precomputed source links win (API pages); twoslash blocks without them fall back to the
      // hover-derived collector the twoslasher fills during preprocessing.
      ...(opts?.links !== undefined && opts.links.length > 0
        ? [Annotate.transformer({ links: opts.links })]
        : opts?.twoslash
        ? [Annotate.transformer({ links: hoverCodeLinks })]
        : []),
    ],
  });
};

/** Highlight a code block to React. Falls back to a plain <pre> for unknown languages. */
export const highlightToReact = (
  code: string,
  lang?: string,
  opts?: { readonly twoslash?: boolean; readonly links?: ReadonlyArray<Annotate.Link> }
): React.ReactNode => {
  const hast = highlightToHast(code, lang, opts);
  if (hast === undefined) {
    const text = code.replace(/\n$/, "");
    return React.createElement("pre", { key: keySeq++ }, React.createElement("code", null, text));
  }
  return hastToReact(hast);
};

/** Render a JSDoc comment body — markdown with `{@link}`, fenced code, bold, etc. — to React, for the
 *  API-reference pages. `loadHighlighter()` must have run first so fenced code can be highlighted. */
export const renderJsdocToReact = (
  docs: string,
  resolveLink?: (target: string) => string | undefined
): React.ReactNode => hastToReact({ type: "root", children: jsdocToHast(docs, resolveLink) });

/**
 * Render an export's REAL source WITH twoslash hover previews. Twoslash type-checks the WHOLE file
 * (so the LSP resolves every identifier — relative imports included, via a `@filename` directive) and
 * `---cut---` trims everything except the target declaration from the display. `loadHighlighter()`
 * must have run first. Returns undefined on any failure so the caller can fall back to plain source.
 */
export const highlightSourceWithHovers = (
  fileText: string, // the whole source file (read by the caller through effect/FileSystem)
  relFile: string, // repo-relative, e.g. "src/WorkPool.ts" — for the @filename directive
  startLine: number, // 1-based first line of the declaration
  endLine: number, // 1-based last line (inclusive)
  ownerDocLinks?: Record<string, string> // the page symbol's resolved {@link} map (for its hovers)
): React.ReactNode | undefined => {
  try {
    const lines = fileText.split("\n");
    // `@filename` places the virtual file at the real path so `./x` imports resolve; `@noErrors`
    // keeps a stray diagnostic from throwing; the cut pair leaves only the declaration on screen.
    const input = [
      "// @noErrors",
      `// @filename: ${relFile}`,
      ...lines.slice(0, startLine - 1),
      "// ---cut---",
      ...lines.slice(startLine - 1, endLine),
      "// ---cut-after---",
      ...lines.slice(endLine),
    ].join("\n");
    currentOwnerDocLinks = ownerDocLinks;
    try {
      // Compiler-resolved token links for the shown span. The twoslash cut leaves EXACTLY lines
      // startLine..endLine visible, so span-relative offsets are visible-code offsets (no shift).
      const links = sourceLinksFor(relFile, startLine, endLine);
      return highlightToReact(input, "ts", { twoslash: true, links });
    } finally {
      currentOwnerDocLinks = undefined;
    }
  } catch {
    return undefined;
  }
};
