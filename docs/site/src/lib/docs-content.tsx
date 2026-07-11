// The docs content pipeline as an Effect service:
//   Djot source -> parse -> Schema-validate rule metadata -> derive manifest
//   -> reject duplicate ids (typed failure) -> render AST to React.
//
// Effect packages only (incl. unstable where relevant). No node:fs — content arrives
// as strings from ./content.ts (Vite module graph).

import { Data, Effect, Schema } from "effect";
import * as djot from "@djot/djot";
import * as React from "react";
import { runServer } from "./runtime.js";
import { chapters, chapterBySlug } from "./content.js";
import { nav } from "../../../nav.js";
import { highlightToReact, loadHighlighter } from "./highlight.js";
import { QueueIsland } from "../islands/QueueIsland.js";
import { RunResourceIsland } from "../islands/RunResourceIsland.js";
import { CounterIsland } from "../islands/CounterIsland.js";

// --- rule metadata schema (machine layer) ---------------------------------
const Severity = Schema.Literals(["must", "should", "may"]);
const Rule = Schema.Struct({
  id: Schema.String,
  severity: Severity,
  appliesTo: Schema.String,
});
const decodeRule = Schema.decodeUnknownEffect(Rule);

export interface Rule {
  readonly id: string;
  readonly severity: "must" | "should" | "may";
  readonly appliesTo: string;
}
export interface ChapterMeta {
  readonly id: string;
  readonly title: string;
  readonly order?: number;
  readonly rules: ReadonlyArray<Rule>;
}

export class DuplicateRuleId extends Data.TaggedError("DuplicateRuleId")<{
  readonly id: string;
}> {}
export class MissingPageBlock extends Data.TaggedError("MissingPageBlock")<{
  readonly detail: string;
}> {}

const severities = new Set(["must", "should", "may"]);

// Walk sections, pull the sparing `{…}` attribute blocks agents wrote.
const collect = (doc: djot.Doc) => {
  let page: { id: string; title: string; order?: string } | undefined;
  const raw: Array<{ id: string; severity: string; appliesTo: string }> = [];
  const walk = (n: any) => {
    if (n?.tag === "section") {
      const a = n.attributes ?? {};
      const sev = (a.class ?? "").split(/\s+/).find((c: string) => severities.has(c));
      if (a.id && sev) raw.push({ id: `${page?.id ?? "?"}.${a.id}`, severity: sev, appliesTo: a.appliesTo ?? "all" });
      else if (a.id && a.title && !page) page = { id: a.id, title: a.title, order: a.order };
    }
    for (const c of n?.children ?? []) walk(c);
  };
  walk(doc);
  return { page, raw };
};

// Effect: parse + validate + build the manifest. Typed failures on bad content.
const parseChapter = (raw: string) =>
  Effect.gen(function* () {
    const doc = yield* Effect.try(() => djot.parse(raw));
    const { page, raw: rawRules } = collect(doc);
    if (!page) {
      return yield* Effect.fail(
        new MissingPageBlock({ detail: "no `{#id title=… }` page block above the H1" }),
      );
    }
    const rules = yield* Effect.forEach(rawRules, decodeRule);
    const seen = new Set<string>();
    for (const r of rules) {
      if (seen.has(r.id)) return yield* Effect.fail(new DuplicateRuleId({ id: r.id }));
      seen.add(r.id);
    }
    const meta: ChapterMeta = {
      id: page.id,
      title: page.title,
      order: page.order === undefined ? undefined : Number(page.order),
      rules,
    };
    return { doc, meta };
  });

// --- render layer: Djot AST -> React elements (no dangerouslySetInnerHTML) ---
let keySeq = 0;
const kids = (n: any) => (n.children ?? []).map(toReact);
const toReact = (n: any): React.ReactNode => {
  const h = React.createElement;
  switch (n.tag) {
    case "doc": return h(React.Fragment, { key: keySeq++ }, kids(n));
    case "section": {
      const a = n.attributes ?? {};
      return h("section", { key: keySeq++, id: a.id, className: a.class }, kids(n));
    }
    case "heading": return h(`h${n.level ?? 2}`, { key: keySeq++ }, kids(n));
    case "para": return h("p", { key: keySeq++, className: n.attributes?.class }, kids(n));
    case "str": return n.text;
    case "soft_break": case "softbreak": return " ";
    case "verbatim": return h("code", { key: keySeq++ }, n.text);
    case "strong": return h("strong", { key: keySeq++ }, kids(n));
    case "emph": return h("em", { key: keySeq++ }, kids(n));
    case "link": return h("a", { key: keySeq++, href: n.destination }, kids(n));
    case "bullet_list": return h("ul", { key: keySeq++ }, kids(n));
    case "ordered_list": return h("ol", { key: keySeq++ }, kids(n));
    case "list_item": return h("li", { key: keySeq++ }, kids(n));
    case "code_block":
      // island seam: a ```queue block becomes a live client component (RSC boundary)
      if (n.lang === "queue") return h(QueueIsland, { key: keySeq++ });
      if (n.lang === "run-resource") return h(RunResourceIsland, { key: keySeq++ });
      if (n.lang === "resource") return h(CounterIsland, { key: keySeq++ });
      // everything else is Shiki-highlighted server-side (real React nodes)
      return highlightToReact(n.text, n.lang);
    default: return kids(n);
  }
};

export interface RenderedChapter {
  readonly element: React.ReactNode;
  readonly meta: ChapterMeta;
}

// Server entry: run the Effect pipeline (RuntimeServer) and return React + meta.
export const renderChapter = async (raw: string): Promise<RenderedChapter> => {
  const { doc, meta } = await runServer(parseChapter(raw));
  await loadHighlighter(); // ready the (sync) highlighter before the walk
  keySeq = 0;
  return { element: toReact(doc), meta };
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
      Effect.catch(() => Effect.succeed({ id: slug, title: slug, rules: [] } as ChapterMeta)),
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
