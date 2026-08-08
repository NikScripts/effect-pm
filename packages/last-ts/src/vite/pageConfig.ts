/**
 * Vite transform — inject Waku `getConfig` from `Page.make` / `Page.static`
 * so apps never write engine config.
 *
 * Waku’s fs-router defaults every file page to `render: "static"`. Slug routes
 * then require `staticPaths` unless we override to `dynamic`. This plugin
 * stamps the override from the page class factory used in the module.
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
    if (!usesAsDefault.test(code) && !usesPageMake.test(code) && !usesPageStatic.test(code)) {
      return null;
    }

    // Page.make = dynamic (SSR). Page.static = bake. Waku defaults to static.
    const render = usesPageStatic.test(code) ? "static" : "dynamic";
    const suffix = `

${injectedBanner}
export const getConfig = async () =>
  ({ render: ${JSON.stringify(render)} } as const);
`;
    return { code: code + suffix, map: null };
  },
});
