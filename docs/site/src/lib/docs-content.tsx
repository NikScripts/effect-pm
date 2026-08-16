// The docs RENDER pipeline: parsed chapter (from ./standards-manifest) -> React elements,
// plus the nav derived from each page's own block. Parsing + rule-metadata + the derived
// manifest live in ./standards-manifest.ts — the single parser shared with the manifest
// generator, so nothing hand-copies rule data (Principles → Derive from the contract).
//
// Effect packages only (incl. unstable where relevant). No node:fs — chapter markdown and
// `{.twoslash include="examples/…"}` sources arrive as strings from Vite `?raw` globs
// (`./content.ts`, `./example-sources.ts`).

import { Effect } from "effect";
import * as React from "react";
import { runServer } from "./runtime.js";
import { chapters, chapterBySlug } from "./content.js";
import { nav } from "../../../nav.js";
import { highlightToReact, loadHighlighter } from "./highlight.js";
import { exampleSource } from "./example-sources.js";
import { prepareExampleForTwoslash } from "./example-include.js";
// Lightweight islands only — PackageInstall / CopyButton stay static so every code block can copy.
// Demo / protocol islands pull heavier client graphs (Hyperlink+Ref+Store+widgets.css, or the
// listen-protocol tabber); import those ONLY when the chapter contains their fence lang, otherwise
// /docs/install and peers modulepreload unused JS (Lighthouse unused-js).
import { PackageInstall } from "../islands/PackageInstall.js";
import { CopyButton } from "../islands/CopyButton.js";
import { type ChapterMeta, expandScopes, parseChapter } from "./standards-manifest.js";
import { buildTermIndex, slugify } from "./glossary.js";
import { asLinkTo, resolveBookHref, urls, type Site } from "./siteRoutes.js";
import type * as Route from "last-ts/Route";

/** Per-chapter island slots — filled by `loadDemoIslands` before `toReact`. */
let demoIslands: {
  queue?: React.ComponentType;
  gate?: React.ComponentType;
  hyperlink?: React.ComponentType;
  listen?: React.ComponentType<{ defaultProto?: string }>;
  viewJsx?: React.ComponentType;
  viewSidebar?: React.ComponentType;
  routerPage?: React.ComponentType;
  titleLive?: React.ComponentType;
} = {};

const collectFenceLangs = (n: any, out: Set<string> = new Set()): Set<string> => {
  if (n?.tag === "code_block" && typeof n.lang === "string" && n.lang !== "") out.add(n.lang);
  for (const c of n?.children ?? []) collectFenceLangs(c, out);
  return out;
};

const loadDemoIslands = async (doc: any): Promise<void> => {
  demoIslands = {};
  const langs = collectFenceLangs(doc);
  if (langs.has("queue")) {
    demoIslands.queue = (await import("../islands/QueueIsland.js")).QueueIsland;
  }
  if (langs.has("gate") || langs.has("run-resource")) {
    demoIslands.gate = (await import("../islands/GateIsland.js")).GateIsland;
  }
  if (langs.has("hyperlink")) {
    demoIslands.hyperlink = (await import("../islands/CounterIsland.js")).CounterIsland;
  }
  if (langs.has("listen")) {
    demoIslands.listen = (await import("../islands/ListenProtocol.js")).ListenProtocol;
  }
  if (langs.has("view-jsx")) {
    demoIslands.viewJsx = (await import("../islands/ViewJsxIsland.js")).ViewJsxIsland;
  }
  if (langs.has("view-sidebar")) {
    demoIslands.viewSidebar = (
      await import("../islands/ViewSidebarIsland.js")
    ).ViewSidebarIsland;
  }
  if (langs.has("router-page")) {
    demoIslands.routerPage = (
      await import("../islands/RouterPageIsland.js")
    ).RouterPageIsland;
  }
  if (langs.has("title-live")) {
    demoIslands.titleLive = (await import("../islands/TitleLiveIsland.js")).TitleLiveIsland;
  }
}

// Re-exported for back-compat: the glossary data now lives in ./glossary (shared with highlight.ts).
export { glossaryEntries, type GlossaryEntry } from "./glossary.js";

// The copy button copies the *visible* code: Twoslash preambles / ranges stay behind cut markers
// (`---cut---`, `---cut-after---`, `---cut-start---`/`---cut-end---`) — mirror what the reader sees.
const CUT = /^\s*\/\/\s*---cut(-before)?---\s*$/;
const CUT_AFTER = /^\s*\/\/\s*---cut-after---\s*$/;
const CUT_START = /^\s*\/\/\s*---cut-start---\s*$/;
const CUT_END = /^\s*\/\/\s*---cut-end---\s*$/;
const visibleCode = (text: string): string => {
  const out: Array<string> = [];
  let hidingRange = false;
  let seenCut = false;
  let buf: Array<string> = [];
  for (const line of text.split("\n")) {
    if (CUT_START.test(line)) {
      hidingRange = true;
      continue;
    }
    if (CUT_END.test(line)) {
      hidingRange = false;
      continue;
    }
    if (hidingRange) continue;
    if (CUT_AFTER.test(line)) break;
    if (CUT.test(line)) {
      seenCut = true;
      buf = [];
      continue;
    }
    (seenCut ? buf : out).push(line);
  }
  const lines = seenCut ? buf : out;
  return lines.join("\n").replace(/^\n+|\n+$/g, "");
};

/**
 * Resolve `{.twoslash include="examples/…"}`. The runnable file is SSOT; an optional fence body
 * is prepended (Twoslash directives like `// @noErrors`, short page-only notes) then discarded
 * from copy via the usual cut markers in the included file.
 */
const resolveFenceText = (n: {
  readonly text?: string;
  readonly attributes?: Record<string, string>;
}): string => {
  const include = n.attributes?.include?.trim();
  if (include === undefined || include === "") return n.text ?? "";
  const raw = exampleSource(include);
  if (raw === undefined) {
    throw new Error(
      `docs fence include not in examples/docs-last-site glob: "${include}" (expected under examples/<topic> or docs/last/site/src)`,
    );
  }
  const prepared = prepareExampleForTwoslash(raw, include);
  const preamble = (n.text ?? "").trim();
  // Directives in the fence body must precede `@filename` so Twoslash still sees them.
  return preamble === "" ? prepared : `${preamble}\n${prepared}`;
};

// --- render layer: Djot AST -> React elements (no dangerouslySetInnerHTML) ---
let keySeq = 0;
const kids = (n: any) => (n.children ?? []).map(toReact);

// plain text of an inline tree (for heading ids + the on-this-page TOC).
const plainText = (n: any): string =>
  n.tag === "str" || n.tag === "verbatim"
    ? (n.text ?? "")
    : (n.children ?? []).map(plainText).join("");

export interface TocEntry {
  readonly id: string;
  readonly text: string;
  readonly level: number;
}
// the page's h2/h3 headings, in order — the on-this-page nav.
const buildToc = (doc: any): ReadonlyArray<TocEntry> => {
  const out: Array<TocEntry> = [];
  const walk = (n: any): void => {
    if (n?.tag === "heading" && (n.level === 2 || n.level === 3)) {
      const text = plainText(n).trim();
      if (text) out.push({ id: slugify(text), text, level: n.level });
    }
    (n?.children ?? []).forEach(walk);
  };
  walk(doc);
  return out;
};

// --- auto-linking: the first capitalized mention of a glossary term on a page becomes a
// link to its glossary entry. Capitalized whole-word match only, so the capitalization rule
// is the concept signal — a lowercase (generic) use never links. Manual links win: any term
// the author linked by hand is seeded as already-linked, so it stays the only link and auto
// never doubles it. Suppressed inside headings, inline code, and existing links.
let autoLink = false;
let suppress = 0;
let linkedSlugs = new Set<string>();
let termRegex: RegExp | null = null;
let termToSlug: ReadonlyMap<string, string> = new Map();

// Manual links win: pre-seed every glossary term the author already linked by hand.
const glossaryHref = /\/docs\/glossary#([a-z0-9-]+)/;
const seedManualLinks = (n: any): void => {
  if (n?.tag === "link" && typeof n.destination === "string") {
    const m = glossaryHref.exec(n.destination);
    if (m !== null) linkedSlugs.add(m[1]);
  }
  (n?.children ?? []).forEach(seedManualLinks);
};

const linkifyText = (text: string): React.ReactNode => {
  if (!autoLink || suppress > 0 || termRegex === null) return text;
  termRegex.lastIndex = 0;
  const parts: Array<React.ReactNode> = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = termRegex.exec(text)) !== null) {
    const slug = termToSlug.get(m[1]);
    if (slug === undefined || linkedSlugs.has(slug)) continue; // already linked → leave as text
    linkedSlugs.add(slug);
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(
      React.createElement("a", {
        key: keySeq++,
        href: `${urls.docs("glossary")}#${slug}`,
      }, m[0]),
    );
    last = m.index + m[0].length;
  }
  if (parts.length === 0) return text;
  if (last < text.length) parts.push(text.slice(last));
  return React.createElement(React.Fragment, { key: keySeq++ }, parts);
};

const toReact = (n: any): React.ReactNode => {
  const h = React.createElement;
  switch (n.tag) {
    case "doc": return h(React.Fragment, { key: keySeq++ }, kids(n));
    case "section": {
      const a = n.attributes ?? {};
      const sev = (a.class ?? "")
        .split(/\s+/)
        .find((c: string) => c === "must" || c === "should" || c === "may");
      const scopes = sev && a.appliesTo ? expandScopes(a.appliesTo) : [];
      // A rule section gets an appliesTo chip row right under its heading, so the page
      // SHOWS where the rule applies (src / examples / test / docs / process) beside
      // the severity chip — not just the manifest.
      if (scopes.length === 0) {
        return h("section", { key: keySeq++, id: a.id, className: a.class }, kids(n));
      }
      const children: Array<React.ReactNode> = [];
      for (const c of n.children ?? []) {
        children.push(toReact(c));
        if (c.tag === "heading") {
          children.push(
            h(
              "p",
              { key: keySeq++, className: "applies-to" },
              scopes.map((s) => h("span", { key: keySeq++, className: "scope-chip" }, s)),
            ),
          );
        }
      }
      return h("section", { key: keySeq++, id: a.id, className: a.class }, children);
    }
    case "heading": {
      const level = n.level ?? 2;
      const id = level === 2 || level === 3 ? slugify(plainText(n).trim()) : undefined;
      suppress++;
      const inner = kids(n);
      suppress--;
      return h(`h${level}`, { key: keySeq++, id, className: n.attributes?.class }, inner);
    }
    case "para": return h("p", { key: keySeq++, className: n.attributes?.class }, kids(n));
    case "str": return linkifyText(n.text);
    case "soft_break": case "softbreak": return " ";
    case "hard_break": case "hardbreak": return h("br", { key: keySeq++ });
    case "verbatim": return h("code", { key: keySeq++ }, n.text);
    case "strong": {
      // Djot encodes `**text**` as strong→strong→text (`*` is one strong). Collapse the
      // wrappers so SSR emits a single <strong> (nested strong is valid but noisy).
      let node = n;
      while (
        Array.isArray(node.children) &&
        node.children.length === 1 &&
        node.children[0]?.tag === "strong"
      ) {
        node = node.children[0];
      }
      return h("strong", { key: keySeq++ }, kids(node));
    }
    case "emph": return h("em", { key: keySeq++ }, kids(n));
    case "link": {
      suppress++;
      const inner = kids(n);
      suppress--;
      const dest = String(n.destination ?? "");
      return h("a", { key: keySeq++, href: resolveBookHref(dest) }, inner);
    }
    case "bullet_list": return h("ul", { key: keySeq++ }, kids(n));
    case "ordered_list": return h("ol", { key: keySeq++ }, kids(n));
    case "list_item": return h("li", { key: keySeq++ }, kids(n));
    case "table": {
      // Browsers insert an implicit <tbody> around bare <tr>s when parsing SSR HTML. React's
      // client tree still expects the bare rows → hydration #418 on every guide page with a
      // pipe table. Emit thead/tbody explicitly; skip Djot's always-present empty caption.
      const children: ReadonlyArray<any> = n.children ?? [];
      const caption = children.find((c) => c.tag === "caption");
      const rows = children.filter((c) => c.tag === "row");
      const headRows = rows.filter((c) => c.head === true);
      const bodyRows = rows.filter((c) => c.head !== true);
      const out: Array<React.ReactNode> = [];
      if (caption !== undefined && plainText(caption).trim() !== "") {
        out.push(h("caption", { key: keySeq++ }, kids(caption)));
      }
      if (headRows.length > 0) {
        out.push(h("thead", { key: keySeq++ }, headRows.map(toReact)));
      }
      if (bodyRows.length > 0) {
        out.push(h("tbody", { key: keySeq++ }, bodyRows.map(toReact)));
      }
      return h("table", { key: keySeq++ }, out);
    }
    case "caption": return h("caption", { key: keySeq++ }, kids(n));
    case "row": return h("tr", { key: keySeq++ }, kids(n));
    case "cell": {
      const align = n.align && n.align !== "default" ? { textAlign: n.align } : undefined;
      return h(n.head ? "th" : "td", { key: keySeq++, style: align }, kids(n));
    }
    case "code_block":
      // island seam: ```queue/gate/hyperlink → live client islands (loaded only when present)
      if (n.lang === "queue") {
        return demoIslands.queue !== undefined
          ? h(demoIslands.queue, { key: keySeq++ })
          : null;
      }
      if (n.lang === "gate" || n.lang === "run-resource") {
        return demoIslands.gate !== undefined
          ? h(demoIslands.gate, { key: keySeq++ })
          : null;
      }
      if (n.lang === "hyperlink") {
        return demoIslands.hyperlink !== undefined
          ? h(demoIslands.hyperlink, { key: keySeq++ })
          : null;
      }
      if (n.lang === "view-jsx") {
        return demoIslands.viewJsx !== undefined
          ? h(demoIslands.viewJsx, { key: keySeq++ })
          : null;
      }
      if (n.lang === "view-sidebar") {
        return demoIslands.viewSidebar !== undefined
          ? h(demoIslands.viewSidebar, { key: keySeq++ })
          : null;
      }
      if (n.lang === "router-page") {
        return demoIslands.routerPage !== undefined
          ? h(demoIslands.routerPage, { key: keySeq++ })
          : null;
      }
      if (n.lang === "title-live") {
        return demoIslands.titleLive !== undefined
          ? h(demoIslands.titleLive, { key: keySeq++ })
          : null;
      }
      if (n.lang === "install") return h(PackageInstall, { key: keySeq++, packages: n.text });
      // protocol-listen overload family — tabs switch http / ws / unix / nPipe
      if (n.lang === "listen") {
        return demoIslands.listen !== undefined
          ? h(demoIslands.listen, {
              key: keySeq++,
              defaultProto: n.text.trim() || undefined,
            })
          : null;
      }
      // everything else is Shiki-highlighted server-side (real React nodes). A `{.twoslash}`
      // attribute above the fence opts the block into TS-language-service hover types.
      // `include="examples/…"` pulls the runnable `.ts` (cuts live in that file). Wrapped in a
      // `.code-block` container carrying the copy button; line numbers are pure CSS on `.line`.
      // Included fences show the repo-relative path as a file chrome label.
      {
        const twoslash = (n.attributes?.class ?? "").split(/\s+/).includes("twoslash");
        const include = n.attributes?.include?.trim();
        const text = resolveFenceText(n);
        return h(
          "div",
          { key: keySeq++, className: "code-block" },
          include !== undefined && include !== ""
            ? h("div", { key: keySeq++, className: "code-block-file" }, include)
            : null,
          h(CopyButton, { key: keySeq++, code: visibleCode(text) }),
          highlightToReact(text, n.lang, { twoslash }),
        );
      }
    default: return kids(n);
  }
};

export interface RenderedChapter {
  readonly element: React.ReactNode;
  readonly meta: ChapterMeta;
  readonly toc: ReadonlyArray<TocEntry>;
}

// Server entry: run the Effect pipeline (RuntimeServer) and return React + meta + on-this-page TOC.
export const renderChapter = async (raw: string): Promise<RenderedChapter> => {
  const { doc, meta } = await runServer(parseChapter(raw));
  await loadHighlighter(); // ready the (sync) highlighter before the walk
  await loadDemoIslands(doc); // dynamic-import heavy demos only when this chapter needs them
  keySeq = 0;
  suppress = 0;
  linkedSlugs = new Set();
  const idx = buildTermIndex();
  termRegex = idx.regex;
  termToSlug = idx.termToSlug;
  autoLink = false; // glossary auto-linking disabled for now (re-enable: `meta.id !== "glossary"`)
  seedManualLinks(doc);
  return { element: toReact(doc), meta, toc: buildToc(doc) };
};

// Lightweight: just the title/meta (for nav), no render.
export const chapterMeta = (raw: string): Promise<ChapterMeta> =>
  runServer(parseChapter(raw).pipe(Effect.map(({ meta }) => meta)));

export interface NavItem {
  readonly slug: string;
  readonly href: Route.ToHref<Site>;
  readonly title: string;
  readonly order?: number;
}

// Book URLs are flat: `docs/guides/queues.md` and `docs/examples/queue/foo.md` become
// `/docs/queues` and `/docs/foo` (folder is organization only). Basename must be unique
// site-wide — see the collision guard in `content.ts`.
const hrefFor = (slug: string, _group: string): Route.ToHref<Site> =>
  urls.docs(slug);

// Resolve one slug to a nav item; the title comes from the page's own block (SSOT).
// A parse error falls back to the slug so one bad file can't blank the nav.
const itemForSlug = (slug: string): Promise<NavItem | undefined> => {
  const c = chapterBySlug(slug);
  if (c === undefined) return Promise.resolve(undefined);
  return runServer(
    parseChapter(c.raw).pipe(
      Effect.map(({ meta }) => meta),
      Effect.catch(() =>
        Effect.succeed<ChapterMeta>({
          id: slug,
          title: slug,
          rules: [],
        }),
      ),
    ),
  ).then((meta) => ({ slug, href: hrefFor(slug, c.group), title: meta.title }));
};

export interface NavGroup {
  readonly label: string;
  readonly items: ReadonlyArray<NavItem>;
  readonly lone?: boolean; // a standalone page — render as a lone link, not a collapsible group
}

// The grouped, ordered nav — structure from docs/nav.ts, titles from each page. Any
// content file not listed in the manifest lands under "More" so nothing silently vanishes.
export const navGroups = async (): Promise<ReadonlyArray<NavGroup>> => {
  const listed = new Set<string>();
  const groups: Array<NavGroup> = [];
  for (const g of nav) {
    // A direct-link lone entry (e.g. Examples → /docs/examples): one synthetic item, no slug resolution.
    if (g.href !== undefined) {
      groups.push({
        label: g.label,
        items: [
          {
            slug: "",
            href: asLinkTo(resolveBookHref(g.href)),
            title: g.label,
          },
        ],
        lone: true,
      });
      continue;
    }
    // A group of direct route links (e.g. API Reference → per-package pages): synthetic items.
    if (g.links !== undefined) {
      groups.push({
        label: g.label,
        items: g.links.map((l) => ({
          slug: "",
          href: asLinkTo(resolveBookHref(l.href)),
          title: l.label,
        })),
      });
      continue;
    }
    const items: Array<NavItem> = [];
    for (const slug of g.slugs ?? []) {
      const it = await itemForSlug(slug);
      if (it !== undefined) {
        items.push(it);
        listed.add(slug);
      }
    }
    if (items.length > 0) groups.push({ label: g.label, items, lone: g.lone });
  }
  const extras: Array<NavItem> = [];
  for (const c of chapters) {
    if (listed.has(c.slug)) continue;
    // Paired example docs live under docs/examples/** — linked from the Examples hub only.
    // Do not dump them into sidebar "More".
    if (c.group === "examples" || c.group.startsWith("examples/")) continue;
    // Glossary is a footer link, deliberately out of the sidebar — keep it out of "More" too.
    if (c.slug === "glossary") continue;
    const it = await itemForSlug(c.slug);
    if (it !== undefined) extras.push(it);
  }
  if (extras.length > 0) groups.push({ label: "More", items: extras });
  return groups;
};

// The flat book order (groups concatenated) — the sequence prev/next walks.
export const navItems = async (): Promise<ReadonlyArray<NavItem>> =>
  (await navGroups()).flatMap((g) => g.items);

export interface AdjacentPages {
  readonly prev?: NavItem;
  readonly next?: NavItem;
}

// Prev/next by position in the flattened book — crosses group boundaries so the docs
// read like one continuous book.
export const prevNext = async (slug: string): Promise<AdjacentPages> => {
  const items = await navItems();
  const i = items.findIndex((it) => it.slug === slug);
  if (i < 0) return {};
  return { prev: items[i - 1], next: items[i + 1] };
};
