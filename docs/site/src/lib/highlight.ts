// Server-side syntax highlighting with Shiki.
//
// Shiki highlights at render time (dev) / build time (SSG) — no client JS ships, the
// coloured markup is baked into the static HTML. Output is dual-theme (github-light +
// github-dark); docs.css switches tokens under `prefers-color-scheme: dark`.
//
// We render Shiki's HAST as real React elements (no dangerouslySetInnerHTML).

import { fileURLToPath } from "node:url";
import * as React from "react";
import * as ts from "typescript";
import { createHighlighter, type Highlighter } from "shiki";
import { createTransformerFactory, rendererRich } from "@shikijs/twoslash";
import { createTwoslasher } from "twoslash";
import { fromMarkdown } from "mdast-util-from-markdown";
import { toHast } from "mdast-util-to-hast";
import { makeTypeExpander } from "./expandType";

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
// package name to its source so `@nikscripts/effect-pm/*` → `src/*`.
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const compilerOptions: ts.CompilerOptions = {
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  skipLibCheck: true,
  types: [],
  baseUrl: repoRoot,
  paths: {
    "@nikscripts/effect-pm": ["src/index.ts"],
    "@nikscripts/effect-pm/*": ["src/*"],
  },
};

// Map a twoslash node offset (in the trimmed/visible code) back to the full-code offset (the code
// twoslash was given, `---cut---` preamble included), so our expander's checker points at the right
// node. `removals` are ranges removed from the full code to produce the visible output.
const toFullOffset = (
  visible: number,
  removals: ReadonlyArray<readonly [number, number]>,
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
const expandTypes = makeTypeExpander({ compilerOptions, vfsRoot: repoRoot });

// Sentinel wrapping our expansion inside `node.docs` (a field that survives to the renderer, unlike
// arbitrary props). The renderer splits it off and wedges it as its own box between the type and the
// real JSDoc comments.
const EXPAND_OPEN = "@@PMEXPAND@@";

// The declaration head of a hover — `const emails: QueueResource<…>` → `const emails: ` (everything up
// to the type), so the expanded box reads as the same declaration with the body spelled out.
const declHead = (text: string): string => text.match(/^([\s\S]*?:\s)/)?.[1] ?? "";

// Cache expansions per block code (dev re-renders the same block repeatedly).
const blockCache = new Map<string, Map<number, string>>();

const twoslasher = Object.assign(
  (
    code: string,
    extension: Parameters<typeof baseTwoslasher>[1],
    options: Parameters<typeof baseTwoslasher>[2],
  ): ReturnType<typeof baseTwoslasher> => {
    const result = baseTwoslasher(code, extension, options);
    try {
      const hovers = result.nodes.filter(
        (n): n is typeof n & { text: string; start: number; docs?: string } =>
          n.type === "hover" || n.type === "query",
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
        const expanded = expansions!.get(offsets[i]);
        if (!expanded) return;
        const head = declHead(h.text);
        // Need a real declaration head (`const emails: `) so the box reads as a declaration, not a
        // bare `{ … }`. Skip type-name / class / alias hovers that have none.
        if (!head) return;
        // Skip when the hover already shows the shape inline (its type is already an object literal).
        if (h.text.slice(head.length).trimStart().startsWith("{")) return;
        const prior = (h as { docs?: string }).docs;
        (h as { docs?: string }).docs = `${prior ? `${prior}\n` : ""}${EXPAND_OPEN}${head}${expanded}`;
      });
    } catch {
      // Expansion is best-effort: on any failure keep the plain (compact) twoslash hovers.
    }
    return result;
  },
  // A `TwoslashInstance` is callable + carries a `getCacheMap`; reuse the base instance's.
  { getCacheMap: baseTwoslasher.getCacheMap },
);

// HAST helpers to splice the expanded box into the popup, and a renderer that inserts it BETWEEN the
// compact type box and the JSDoc-comments box.
const classListOf = (n: any): string[] => {
  const c = n?.properties?.class;
  return Array.isArray(c) ? c : typeof c === "string" ? c.split(/\s+/) : [];
};
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
  return md.replace(
    /\{@link\s+([^}|\s]+)(?:\s*\|\s*|\s+)?([^}]*?)\s*\}/g,
    (_m, target, text) => label(String(target), String(text ?? "")),
  );
}

function jsdocToHast(this: any, docs: string): any[] {
  const tree = fromMarkdown(preprocessJsdoc(docs));
  const root: any = toHast(tree, {
    handlers: {
      // fenced code block -> shiki-highlighted, wrapped in our styled container
      code: (_state: any, node: any) => {
        const lang = (node.lang && ALIAS[String(node.lang).toLowerCase()]) || "typescript";
        let children: any[];
        try {
          children = (this as any).codeToHast(String(node.value), {
            ...(this as any).options,
            meta: {},
            transformers: [],
            lang,
            structure: "classic",
          }).children;
        } catch {
          children = [{ type: "element", tagName: "pre", properties: {}, children: [{ type: "text", value: String(node.value) }] }];
        }
        return { type: "element", tagName: "div", properties: { className: ["twoslash-popup-docs-code"] }, children };
      },
      // `{@link …}` (rewritten to an `@link:` sentinel URL above) -> a styled, non-navigating
      // reference. Real markdown links keep their <a> and open in a new tab.
      link: (state: any, node: any) => {
        const children = state.all(node);
        const url = typeof node.url === "string" ? node.url : "";
        return url.startsWith("@link:")
          ? { type: "element", tagName: "span", properties: { className: ["twoslash-jsdoc-link"] }, children }
          : { type: "element", tagName: "a", properties: { href: url, target: "_blank", rel: ["noreferrer"] }, children };
      },
    },
  });
  return root?.children ?? [];
}
function renderJsdocMarkdown(this: any, docs: string): any[] {
  return jsdocToHast.call(this, docs);
}
// Inline context (JSDoc @tag values): parse the same way, but unwrap a lone paragraph so a one-line
// value (e.g. `@since 4.0.0`) doesn't become a block.
function renderJsdocInline(this: any, text: string): any[] {
  const hast = jsdocToHast.call(this, text);
  if (hast.length === 1 && hast[0]?.tagName === "p") return hast[0].children;
  return hast;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- HAST renderer plumbing
const baseRenderer: any = rendererRich({
  renderMarkdown: renderJsdocMarkdown as never,
  renderMarkdownInline: renderJsdocInline as never,
});
const renderer = {
  ...baseRenderer,
  nodeStaticInfo(this: any, info: any, node: any) {
    const code = splitExpand(info);
    const el = baseRenderer.nodeStaticInfo.call(this, info, node);
    if (code) try { insertExpand.call(this, el, code); } catch { /* keep plain popup */ }
    return el;
  },
  nodeQuery(this: any, info: any, node: any) {
    const code = splitExpand(info);
    const el = baseRenderer.nodeQuery.call(this, info, node);
    if (code) try { insertExpand.call(this, el, code); } catch { /* keep plain popup */ }
    return el;
  },
};
const twoslash = createTransformerFactory(twoslasher, renderer as never)({});

let hl: Highlighter | undefined;

/** Load the shared highlighter once, before the (sync) render walk. */
export const loadHighlighter = async (): Promise<void> => {
  if (!hl) {
    hl = await createHighlighter({
      themes: [THEMES.light, THEMES.dark],
      langs: [...LOAD_LANGS],
    });
  }
};

// HTML attribute → React prop name for the few twoslash emits that React is strict about.
const ATTR_RENAME: Record<string, string> = { tabindex: "tabIndex", for: "htmlFor", colspan: "colSpan", rowspan: "rowSpan" };

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
    style[prop.startsWith("--") ? prop : prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
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
  return React.createElement(node.tagName, props, (node.children ?? []).map(hastToReact));
};

/** Highlight a code block to React. `twoslash` runs the TS language service for hover types.
 *  Falls back to a plain <pre> for unknown languages. */
export const highlightToReact = (
  code: string,
  lang?: string,
  opts?: { readonly twoslash?: boolean },
): React.ReactNode => {
  const text = code.replace(/\n$/, "");
  const resolved = lang ? ALIAS[lang.toLowerCase()] : undefined;
  if (!hl || !resolved) {
    return React.createElement("pre", { key: keySeq++ }, React.createElement("code", null, text));
  }
  const hast = hl.codeToHast(text, {
    lang: resolved,
    themes: THEMES,
    transformers: opts?.twoslash ? [twoslash] : [],
  });
  return hastToReact(hast);
};
