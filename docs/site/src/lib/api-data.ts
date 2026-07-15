// Server-side access to the split API data (docs/site/api-data, produced by scripts/gen-api.ts).
// Each function reads ONLY the file a page needs — never one big model — so pages stay small and the
// reference scales to many packages. Read at build (SSG) / dev; the result is baked into static HTML.

import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import { fileURLToPath } from "node:url";

const dataDir = fileURLToPath(new URL("../../api-data/", import.meta.url));

const readJson = <T>(rel: string): T | undefined => {
  try {
    return JSON.parse(nodeFs.readFileSync(nodePath.join(dataDir, rel), "utf8")) as T;
  } catch {
    return undefined;
  }
};

export interface ApiTag {
  readonly name: string;
  readonly text: string;
}
export interface ApiSource {
  readonly file: string;
  readonly line: number;
}
// The full detail for one symbol's own page.
export interface ApiSymbol {
  readonly entry: string;
  readonly name: string;
  readonly qualifiedName: string;
  readonly url: string;
  readonly kind: string;
  readonly signatures: ReadonlyArray<string>;
  readonly typeText?: string;
  readonly sourceText: string;
  readonly summary: string;
  readonly rawComment: string;
  readonly tags: ReadonlyArray<ApiTag>;
  readonly category?: string;
  readonly linkTargets: ReadonlyArray<string>;
  readonly docLinks: Readonly<Record<string, string>>; // {@link X} text -> resolved doc URL
  readonly source: ApiSource;
}
// The light row for a module page (no signatures / source / comments).
export interface ApiSymbolRow {
  readonly name: string;
  readonly qualifiedName: string;
  readonly kind: string;
  readonly summary: string;
  readonly url: string;
}
export interface ModuleInfo {
  readonly slug: string;
  readonly entry: string;
  readonly count: number;
}
export interface PackageInfo {
  readonly slug: string;
  readonly name: string;
  readonly modules: ReadonlyArray<ModuleInfo>;
}
export interface ModuleSummary {
  readonly package: string;
  readonly entry: string;
  readonly symbols: ReadonlyArray<ApiSymbolRow>;
}

// A namespace entry -> its URL slug. Mirrors scripts/gen-api.ts (kept in sync).
export const slugForEntry = (entry: string): string =>
  entry === "(top-level)" ? "top-level" : entry.replace(/\//g, "-");

export const packages = (): ReadonlyArray<PackageInfo> =>
  readJson<{ packages: ReadonlyArray<PackageInfo> }>("index.json")?.packages ?? [];

export const packageBySlug = (slug: string): PackageInfo | undefined =>
  packages().find((p) => p.slug === slug);

export const moduleSummary = (pkg: string, moduleSlug: string): ModuleSummary | undefined =>
  readJson<ModuleSummary>(nodePath.join(pkg, `${moduleSlug}.json`));

export const symbolDetail = (
  pkg: string,
  moduleSlug: string,
  name: string,
): ApiSymbol | undefined => readJson<ApiSymbol>(nodePath.join(pkg, moduleSlug, `${name}.json`));

// Every [pkg, module, symbol] triple — the static paths for the per-symbol route.
export const symbolPaths = (): ReadonlyArray<readonly [string, string, string]> =>
  readJson<{ symbols: ReadonlyArray<readonly [string, string, string]> }>("paths.json")?.symbols ??
  [];

export interface LinkSymbol {
  readonly name: string;
  readonly qualifiedName: string;
  readonly url: string;
}
// The build-only global index used to resolve doc links (name/qualifiedName -> url).
export const linkSymbols = (): ReadonlyArray<LinkSymbol> =>
  readJson<{ symbols: ReadonlyArray<LinkSymbol> }>("links.json")?.symbols ?? [];

export const repoBaseUrl = (): string =>
  readJson<{ repoBaseUrl?: string }>("meta.json")?.repoBaseUrl ?? "";

/** GitHub URL for a symbol's source line, or undefined when no repo base is known. */
export const sourceUrl = (file: string, line: number): string | undefined => {
  const base = repoBaseUrl();
  return base ? `${base}/${file}#L${line}` : undefined;
};
