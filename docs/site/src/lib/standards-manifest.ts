// The standards parser — SSOT for BOTH the live docs page (docs-content.tsx) and the
// committed rule manifest (scripts/gen-manifest.ts). Djot `{#id .severity appliesTo}`
// blocks -> validated rule metadata -> the derived manifest. This is the single home
// the corpus's own `derive-from-the-contract` rule requires: nothing hand-copies the
// manifest anymore. No React, no DOM, no node:* — just Djot AST in, data out.

import { Data, Effect, Schema } from "effect";
import * as djot from "@djot/djot";

// --- scopes ----------------------------------------------------------------
// `appliesTo` is a SET of scopes, space-joined in the block (appliesTo="src examples").
// `all` is sugar for the three code trees; `docs` / `process` are named explicitly.
const scopeExpansions: Record<string, ReadonlyArray<string>> = {
  all: ["src", "examples", "test"],
};

// Split a raw `appliesTo` string into its concrete scopes, expanding `all` and
// de-duplicating while preserving declared order. `"all docs"` -> src, examples, test, docs.
export const expandScopes = (raw: string): ReadonlyArray<string> => {
  const scopes = raw
    .trim()
    .split(/\s+/)
    .filter((tok) => tok !== "")
    .flatMap((tok) => scopeExpansions[tok] ?? [tok]);
  return Array.from(new Set(scopes)); // dedupe, insertion order preserved
};

// --- rule metadata schema (machine layer) ----------------------------------
const Severity = Schema.Literals(["must", "should", "may"]);
const RuleSchema = Schema.Struct({
  id: Schema.String,
  severity: Severity,
  appliesTo: Schema.Array(Schema.String),
  title: Schema.String,
});
const decodeRule = Schema.decodeUnknownEffect(RuleSchema);

export interface Rule {
  readonly id: string;
  readonly severity: "must" | "should" | "may";
  readonly appliesTo: ReadonlyArray<string>;
  readonly title: string;
}
export interface ChapterMeta {
  readonly id: string;
  readonly title: string;
  readonly order?: number;
  /** Migration state, from the page block: "draft" shows the draft note + checklist. */
  readonly status?: string;
  /** Space-separated checklist keys that are complete (e.g. "api types"). */
  readonly done?: ReadonlyArray<string>;
  readonly rules: ReadonlyArray<Rule>;
}

export class DuplicateRuleId extends Data.TaggedError("DuplicateRuleId")<{
  readonly id: string;
}> {}
export class MissingPageBlock extends Data.TaggedError("MissingPageBlock")<{
  readonly detail: string;
}> {}

const severities = new Set(["must", "should", "may"]);

// Flatten a heading's inline text, preserving `verbatim` as backticked code so a title
// like "raw `node:*`" round-trips exactly into the manifest.
const headingText = (n: any): string => {
  switch (n?.tag) {
    case "str":
      return n.text ?? "";
    case "verbatim":
      return "`" + (n.text ?? "") + "`";
    // djot smart-punctuation (a straight `'` → its own node) carries the source char in
    // `.text`; without this the apostrophe in a title like "Don't" would be dropped.
    case "smart_punctuation":
      return n.text ?? "";
    case "soft_break":
    case "softbreak":
      return " ";
    default:
      return (n?.children ?? []).map(headingText).join("");
  }
};

// Walk sections, pull the sparing `{…}` attribute blocks agents wrote. A rule section
// carries a severity class + id; the page section carries id + title. The rule title is
// read from the section's own heading (SSOT — the heading IS the title).
export const collect = (doc: djot.Doc) => {
  let page:
    | { id: string; title: string; order?: string; status?: string; done?: string }
    | undefined;
  const raw: Array<{
    id: string;
    severity: string;
    appliesTo: ReadonlyArray<string>;
    title: string;
  }> = [];
  const walk = (n: any) => {
    if (n?.tag === "section") {
      const a = n.attributes ?? {};
      const sev = (a.class ?? "").split(/\s+/).find((c: string) => severities.has(c));
      if (a.id && sev) {
        const heading = (n.children ?? []).find((c: any) => c.tag === "heading");
        raw.push({
          id: `${page?.id ?? "?"}.${a.id}`,
          severity: sev,
          appliesTo: expandScopes(a.appliesTo ?? "all"),
          title: heading ? headingText(heading).trim() : a.id,
        });
      } else if (a.id && a.title && !page) {
        page = {
          id: a.id,
          title: a.title,
          order: a.order,
          status: a.status,
          done: a.done,
        };
      }
    }
    for (const c of n?.children ?? []) walk(c);
  };
  walk(doc);
  return { page, raw };
};

// Effect: parse + validate + build chapter meta. Typed failures on bad content.
export const parseChapter = (raw: string) =>
  Effect.gen(function* () {
    const doc = yield* Effect.try(() => djot.parse(raw));
    const { page, raw: rawRules } = collect(doc);
    if (!page) {
      return yield* Effect.fail(
        new MissingPageBlock({ detail: "no `{#id title=… }` page block above the H1" }),
      );
    }
    // wrap so forEach's index isn't passed as decode's ParseOptions arg (breaks the overload)
    const rules = yield* Effect.forEach(rawRules, (r) => decodeRule(r));
    const seen = new Set<string>();
    for (const r of rules) {
      if (seen.has(r.id)) return yield* Effect.fail(new DuplicateRuleId({ id: r.id }));
      seen.add(r.id);
    }
    const meta: ChapterMeta = {
      id: page.id,
      title: page.title,
      order: page.order === undefined ? undefined : Number(page.order),
      status: page.status,
      done: page.done === undefined ? undefined : page.done.trim().split(/\s+/).filter(Boolean),
      rules,
    };
    return { doc, meta };
  });

// --- derived manifest ------------------------------------------------------
export interface ManifestChapter {
  readonly chapter: string;
  readonly title: string;
  readonly slug: string;
  readonly rules: ReadonlyArray<Rule>;
}
export interface Manifest {
  readonly generated: string;
  readonly chapters: ReadonlyArray<ManifestChapter>;
  readonly ruleCount: number;
}

export const generatedNote =
  "generated by docs/site/scripts/gen-manifest.ts from docs/standards/*.md " +
  "{#id .severity appliesTo} blocks — run `pnpm docs:manifest`; do not hand-edit";

// Assemble the manifest from parsed chapter metas. Chapters are ordered by slug (the
// alphabetical corpus order); ruleCount is counted, never hand-typed.
export const buildManifest = (metas: ReadonlyArray<ChapterMeta>): Manifest => {
  const chapters = [...metas]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((m) => ({
      chapter: m.id,
      title: m.title,
      slug: m.id,
      rules: m.rules,
    }));
  return {
    generated: generatedNote,
    chapters,
    ruleCount: chapters.reduce((n, c) => n + c.rules.length, 0),
  };
};
