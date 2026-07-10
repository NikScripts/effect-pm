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
import { chapters } from "./content.js";

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
  let page: { id: string; title: string } | undefined;
  const raw: Array<{ id: string; severity: string; appliesTo: string }> = [];
  const walk = (n: any) => {
    if (n?.tag === "section") {
      const a = n.attributes ?? {};
      const sev = (a.class ?? "").split(/\s+/).find((c: string) => severities.has(c));
      if (a.id && sev) raw.push({ id: `${page?.id ?? "?"}.${a.id}`, severity: sev, appliesTo: a.appliesTo ?? "all" });
      else if (a.id && a.title && !page) page = { id: a.id, title: a.title };
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
    const meta: ChapterMeta = { id: page.id, title: page.title, rules };
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
    case "softbreak": return " ";
    case "verbatim": return h("code", { key: keySeq++ }, n.text);
    case "strong": return h("strong", { key: keySeq++ }, kids(n));
    case "emph": return h("em", { key: keySeq++ }, kids(n));
    case "link": return h("a", { key: keySeq++, href: n.destination }, kids(n));
    case "bullet_list": return h("ul", { key: keySeq++ }, kids(n));
    case "ordered_list": return h("ol", { key: keySeq++ }, kids(n));
    case "list_item": return h("li", { key: keySeq++ }, kids(n));
    case "code_block":
      // island seam: a ```queue block becomes a live client component
      if (n.lang === "queue") return h("div", { key: keySeq++, "data-island": "queue-widget" }, "‹live queue widget›");
      return h("pre", { key: keySeq++ }, h("code", { className: n.lang ? `language-${n.lang}` : undefined }, n.text));
    default: return kids(n);
  }
};

export interface RenderedChapter {
  readonly element: React.ReactNode;
  readonly meta: ChapterMeta;
}

// Server entry: run the Effect pipeline (RuntimeServer) and return React + meta.
export const renderChapter = (raw: string): Promise<RenderedChapter> =>
  runServer(
    parseChapter(raw).pipe(
      Effect.map(({ doc, meta }) => {
        keySeq = 0;
        return { element: toReact(doc), meta };
      }),
    ),
  );

// Lightweight: just the title/meta (for nav), no render.
export const chapterMeta = (raw: string): Promise<ChapterMeta> =>
  runServer(parseChapter(raw).pipe(Effect.map(({ meta }) => meta)));

export interface NavItem {
  readonly slug: string;
  readonly href: string;
  readonly title: string;
}

const hrefFor = (slug: string, group: string): string =>
  group === "" && slug === "index" ? "/" : `/docs/${slug}`;

// Nav is derived from the content manifest. A file with a parse error falls back to
// its slug here (so one bad file doesn't blank the whole nav) — its own page still
// fails loudly when rendered.
export const navItems = async (): Promise<ReadonlyArray<NavItem>> => {
  const out: Array<NavItem> = [];
  for (const c of chapters) {
    const meta = await runServer(
      parseChapter(c.raw).pipe(
        Effect.map(({ meta }) => meta),
        Effect.catch(() => Effect.succeed({ id: c.slug, title: c.slug, rules: [] } as ChapterMeta)),
      ),
    );
    out.push({ slug: c.slug, href: hrefFor(c.slug, c.group), title: meta.title });
  }
  // Home first, then the rest alphabetically by title.
  return out.sort((a, b) => (a.href === "/" ? -1 : b.href === "/" ? 1 : a.title.localeCompare(b.title)));
};
