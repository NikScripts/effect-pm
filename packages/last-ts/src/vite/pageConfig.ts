/**
 * Vite transform — inject Waku `getConfig` from `Page.make` / `Page.static`
 * so apps never write engine config.
 *
 * Waku’s fs-router defaults every file page to `render: "static"`. Slug routes
 * then require `staticPaths` unless we override to `dynamic`. This plugin
 * stamps `Page.configOf(<PageClass>)` from the `Page.asDefault(X)` call site.
 *
 * @module vite/pageConfig
 * @internal
 */
import type { Plugin } from "vite";

const pageFile = /(?:^|\/)pages\/.+\.[tj]sx?$/;
const hasOwnGetConfig =
  /\bexport\s+(?:async\s+)?function\s+getConfig\b|\bexport\s+const\s+getConfig\b/;
const usesPageStatic = /extends\s+Page\.static\s*\(/;
const usesPageMake = /extends\s+Page\.make\s*\(/;
const usesAsDefault = /Page\.asDefault\s*\(/;
const asDefaultName =
  /export\s+default\s+Page\.asDefault\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/;
const pageNamespace =
  /import\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s+from\s+["']last-ts\/Page["']/;

const injectedBanner = "/* last-ts: injected Page → Waku getConfig */";

/**
 * Inject `export const getConfig` for `pages/**` modules that use Page classes.
 *
 * @public
 */
export const pageConfig = (): Plugin => ({
  name: "last-ts-page-config",
  enforce: "pre",
  transform(code, id) {
    const file = id.split("?")[0] ?? id;
    if (!pageFile.test(file.replace(/\\/g, "/"))) return null;
    if (code.includes(injectedBanner)) return null;
    if (hasOwnGetConfig.test(code)) return null;
    if (
      !usesAsDefault.test(code) &&
      !usesPageMake.test(code) &&
      !usesPageStatic.test(code)
    ) {
      return null;
    }

    const ns = code.match(pageNamespace)?.[1] ?? "Page";
    const pageName = code.match(asDefaultName)?.[1];

    const suffix =
      pageName !== undefined
        ? `

${injectedBanner}
export const getConfig = async () => ${ns}.configOf(${pageName});
`
        : `

${injectedBanner}
export const getConfig = async () =>
  ({ render: ${JSON.stringify(usesPageStatic.test(code) ? "static" : "dynamic")} } as const);
`;

    return { code: code + suffix, map: null };
  },
});
