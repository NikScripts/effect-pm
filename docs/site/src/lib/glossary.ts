// The glossary as data: parse the glossary Djot page into a { slug -> { term, def } } map, and build
// the term-matching index the auto-linkers use. content.ts is the only dependency, so both the prose
// renderer (docs-content) and the hover renderer (highlight) import this without a cycle.

import { chapterBySlug } from "./content.js";

export const slugify = (s: string): string =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export interface GlossaryEntry {
  readonly term: string;
  readonly def: string;
}

// Each `## Term` heading opens an entry; the paragraph text beneath it (inline markdown stripped) is
// the definition. The glossary Djot page is the single source — this only reads it.
export const glossaryEntries = (): Record<string, GlossaryEntry> => {
  const c = chapterBySlug("glossary");
  if (c === undefined) return {};
  const out: Record<string, GlossaryEntry> = {};
  let term: string | null = null;
  let buf: Array<string> = [];
  const flush = (): void => {
    if (term !== null) {
      const def = buf.join(" ").trim().replace(/`/g, "").replace(/\*\*/g, "");
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

export interface TermIndex {
  readonly regex: RegExp | null;
  readonly termToSlug: ReadonlyMap<string, string>;
}

// Capitalized single-word terms only — the capitalization rule is the concept signal, so a lowercase
// (generic) use never matches. Built fresh on demand (cheap; never stale in dev).
export const buildTermIndex = (): TermIndex => {
  const termToSlug = new Map<string, string>();
  const words: Array<string> = [];
  for (const [slug, { term }] of Object.entries(glossaryEntries())) {
    if (term.includes(" ")) continue; // single-word terms only (v1)
    termToSlug.set(term, slug);
    words.push(term);
  }
  if (words.length === 0) return { regex: null, termToSlug };
  words.sort((a, b) => b.length - a.length);
  const alt = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return { regex: new RegExp(`\\b(${alt})(s?)\\b`, "g"), termToSlug };
};
