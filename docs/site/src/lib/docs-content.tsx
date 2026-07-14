// The docs RENDER pipeline: parsed chapter (from ./standards-manifest) -> React elements,
// plus the nav derived from each page's own block. Parsing + rule-metadata + the derived
// manifest live in ./standards-manifest.ts — the single parser shared with the manifest
// generator, so nothing hand-copies rule data (Principles → Derive from the contract).
//
// Effect packages only (incl. unstable where relevant). No node:fs — content arrives
// as strings from ./content.ts (Vite module graph).

import { Effect } from "effect";
import * as React from "react";
import { runServer } from "./runtime.js";
import { chapters, chapterBySlug } from "./content.js";
import { nav } from "../../../nav.js";
import { highlightToReact, loadHighlighter } from "./highlight.js";
import { QueueIsland } from "../islands/QueueIsland.js";
import { RunResourceIsland } from "../islands/RunResourceIsland.js";
import { CounterIsland } from "../islands/CounterIsland.js";
import { PackageInstall } from "../islands/PackageInstall.js";
import { CopyButton } from "../islands/CopyButton.js";
import { type ChapterMeta, expandScopes, parseChapter } from "./standards-manifest.js";

// The copy button copies the *visible* code: twoslash preambles are hidden behind `// ---cut---`
// markers, so strip everything up to a cut and after a cut-after — mirroring what the reader sees.
const CUT = /^\s*\/\/\s*---cut(-before)?---\s*$/;
const CUT_AFTER = /^\s*\/\/\s*---cut-after---\s*$/;
const visibleCode = (text: string): string => {
  let lines = text.split("\n");
  const start = lines.findIndex((l) => CUT.test(l));
  if (start >= 0) lines = lines.slice(start + 1);
  const end = lines.findIndex((l) => CUT_AFTER.test(l));
  if (end >= 0) lines = lines.slice(0, end);
  return lines.join("\n").replace(/^\n+|\n+$/g, "");
};

// --- render layer: Djot AST -> React elements (no dangerouslySetInnerHTML) ---
let keySeq = 0;
const kids = (n: any) => (n.children ?? []).map(toReact);

// plain text of an inline tree (for heading ids + the on-this-page TOC).
const plainText = (n: any): string =>
  n.tag === "str" || n.tag === "verbatim"
    ? (n.text ?? "")
    : (n.children ?? []).map(plainText).join("");
const slugify = (s: string): string =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

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
      return h(`h${level}`, { key: keySeq++, id }, kids(n));
    }
    case "para": return h("p", { key: keySeq++, className: n.attributes?.class }, kids(n));
    case "str": return n.text;
    case "soft_break": case "softbreak": return " ";
    case "hard_break": case "hardbreak": return h("br", { key: keySeq++ });
    case "verbatim": return h("code", { key: keySeq++ }, n.text);
    case "strong": return h("strong", { key: keySeq++ }, kids(n));
    case "emph": return h("em", { key: keySeq++ }, kids(n));
    case "link": return h("a", { key: keySeq++, href: n.destination }, kids(n));
    case "bullet_list": return h("ul", { key: keySeq++ }, kids(n));
    case "ordered_list": return h("ol", { key: keySeq++ }, kids(n));
    case "list_item": return h("li", { key: keySeq++ }, kids(n));
    case "table": return h("table", { key: keySeq++ }, kids(n));
    case "caption": return h("caption", { key: keySeq++ }, kids(n));
    case "row": return h("tr", { key: keySeq++ }, kids(n));
    case "cell": {
      const align = n.align && n.align !== "default" ? { textAlign: n.align } : undefined;
      return h(n.head ? "th" : "td", { key: keySeq++, style: align }, kids(n));
    }
    case "code_block":
      // island seam: a ```queue block becomes a live client component (RSC boundary)
      if (n.lang === "queue") return h(QueueIsland, { key: keySeq++ });
      if (n.lang === "run-resource") return h(RunResourceIsland, { key: keySeq++ });
      if (n.lang === "resource") return h(CounterIsland, { key: keySeq++ });
      if (n.lang === "install") return h(PackageInstall, { key: keySeq++, packages: n.text });
      // everything else is Shiki-highlighted server-side (real React nodes). A `{.twoslash}`
      // attribute above the fence opts the block into TS-language-service hover types. Wrapped in a
      // `.code-block` container carrying the copy button; line numbers are pure CSS on `.line`.
      {
        const twoslash = (n.attributes?.class ?? "").split(/\s+/).includes("twoslash");
        return h(
          "div",
          { key: keySeq++, className: "code-block" },
          h(CopyButton, { key: keySeq++, code: visibleCode(n.text) }),
          highlightToReact(n.text, n.lang, { twoslash }),
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
  keySeq = 0;
  return { element: toReact(doc), meta, toc: buildToc(doc) };
};

// Lightweight: just the title/meta (for nav), no render.
export const chapterMeta = (raw: string): Promise<ChapterMeta> =>
  runServer(parseChapter(raw).pipe(Effect.map(({ meta }) => meta)));

export interface NavItem {
  readonly slug: string;
  readonly href: string;
  readonly title: string;
  readonly order?: number;
}

const hrefFor = (slug: string, group: string): string =>
  group === "" && slug === "index" ? "/" : `/docs/${slug}`;

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
}

// The grouped, ordered nav — structure from docs/nav.ts, titles from each page. Any
// content file not listed in the manifest lands under "More" so nothing silently vanishes.
export const navGroups = async (): Promise<ReadonlyArray<NavGroup>> => {
  const listed = new Set<string>();
  const groups: Array<NavGroup> = [];
  for (const g of nav) {
    const items: Array<NavItem> = [];
    for (const slug of g.slugs) {
      const it = await itemForSlug(slug);
      if (it !== undefined) {
        items.push(it);
        listed.add(slug);
      }
    }
    if (items.length > 0) groups.push({ label: g.label, items });
  }
  const extras: Array<NavItem> = [];
  for (const c of chapters) {
    if (listed.has(c.slug)) continue;
    const it = await itemForSlug(c.slug);
    if (it !== undefined) extras.push(it);
  }
  if (extras.length > 0) groups.push({ label: "More", items: extras });
  return groups;
};

export interface GlossaryEntry {
  readonly term: string;
  readonly def: string;
}
// Parse the glossary page into a { slug -> { term, def } } map for the hover-preview island. Each
// `## Term` heading opens an entry; the paragraph text beneath it (inline markdown stripped) is the
// definition. The glossary Djot page is the single source — this only reads it.
export const glossaryEntries = (): Record<string, GlossaryEntry> => {
  const c = chapterBySlug("glossary");
  if (c === undefined) return {};
  const out: Record<string, GlossaryEntry> = {};
  let term: string | null = null;
  let buf: Array<string> = [];
  const flush = (): void => {
    if (term !== null) {
      const def = buf.join(" ").trim().replace(/[`*]/g, "");
      if (def) out[slugify(term)] = { term, def };
    }
    buf = [];
  };
  for (const line of c.raw.split("\n")) {
    const m = /^##\s+(.+)$/.exec(line);
    if (m) {
      flush();
      term = m[1].trim();
    } else if (term !== null && line.trim() && !line.startsWith("{")) {
      buf.push(line.trim());
    }
  }
  flush();
  return out;
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
