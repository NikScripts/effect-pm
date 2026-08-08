/**
 * Vite transform — inject Waku `getConfig` from `Page.make` / `Page.static`
 * so apps never write engine config.
 *
 * Waku’s fs-router defaults every file page to `render: "static"`. Slug routes
 * then require `staticPaths` unless we override to `dynamic`. This plugin
 * stamps `Page.configOf(<PageClass>)` from the `Page.asDefault(X)` call site.
 *
 * Also aligns on-disk `pages.gen.ts` after Waku typegen: typegen only sees
 * source-level `getConfig`, so without this pass `Page.make` rest/slug pages
 * regenerate as `static`.
 *
 * @module vite/pageConfig
 * @internal
 */
import type { Plugin } from "vite";
import { Effect } from "effect";
import * as Path from "effect/Path";
import { runPromise } from "../internal/fileRouterPaths";
import { alignPagesGen } from "../internal/pagesGenAlign";

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

type PageConfigOptions = {
  /** Pages directory (relative to Vite root). Default `src/pages`. */
  readonly pagesDir?: string;
  /** Waku `pages.gen.ts` path (relative to Vite root). Default `src/pages.gen.ts`. */
  readonly pagesGenFile?: string;
};

/**
 * Inject `export const getConfig` for `pages/**` modules that use Page classes,
 * and keep `pages.gen.ts` render modes aligned with `Page.make` / `Page.static`.
 *
 * @public
 */
export const pageConfig = (options: PageConfigOptions = {}): Plugin => {
  let root = ".";
  let pagesDir = options.pagesDir ?? "src/pages";
  let pagesGenFile = options.pagesGenFile ?? "src/pages.gen.ts";
  let aligning = false;

  const resolveFromRoot = (p: string): Promise<string> =>
    runPromise(
      Effect.gen(function* () {
        const path = yield* Path.Path;
        return path.isAbsolute(p) ? p : path.resolve(root, p);
      }),
    );

  const runAlign = async (log: (msg: string) => void): Promise<void> => {
    if (aligning) return;
    aligning = true;
    try {
      const result = await runPromise(alignPagesGen(pagesDir, pagesGenFile));
      if (result.changed) {
        const rel = await runPromise(
          Effect.gen(function* () {
            const path = yield* Path.Path;
            return path.relative(root, pagesGenFile);
          }),
        );
        log(`[last-ts] pageConfig: aligned ${rel} render modes`);
      }
    } finally {
      aligning = false;
    }
  };

  return {
    name: "last-ts-page-config",
    enforce: "pre",
    async configResolved(config) {
      root = config.root;
      pagesDir = await resolveFromRoot(options.pagesDir ?? "src/pages");
      pagesGenFile = await resolveFromRoot(
        options.pagesGenFile ?? "src/pages.gen.ts",
      );
    },
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
    async configureServer(server) {
      const align = (): void => {
        void runAlign((msg) => {
          server.config.logger.info(msg);
        });
      };
      // Waku typegen writes `pages.gen.ts` asynchronously on boot / page edits.
      server.watcher.on("change", (file) => {
        const abs = file.replace(/\\/g, "/");
        if (
          abs === pagesGenFile.replace(/\\/g, "/") ||
          abs.startsWith(pagesDir.replace(/\\/g, "/"))
        ) {
          align();
        }
      });
      align();
      // Waku typegen’s first write is async after configureServer; re-align then.
      queueMicrotask(align);
      server.httpServer?.once("listening", align);
    },
  };
};
