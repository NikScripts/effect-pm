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
import { transformerTwoslash } from "@shikijs/twoslash";

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
const twoslash = transformerTwoslash({
  twoslashOptions: {
    vfsRoot: repoRoot,
    compilerOptions: {
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
    },
  },
});

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
