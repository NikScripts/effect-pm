/**
 * @module config
 *
 * Host config façade for last-ts apps. Re-exports the optional Waku peer’s
 * `defineConfig` so application trees never import `waku` / `waku/*`.
 *
 * Keep the on-disk filename the host CLI expects (`waku.config.ts`); the
 * import path is what locks the boundary:
 *
 * ```ts
 * // waku.config.ts — CLI entry name only
 * import { defineConfig } from "last-ts/config"
 * import { fileRouter } from "last-ts/vite"
 *
 * export default defineConfig({
 *   vite: { plugins: [fileRouter({ pagesDir: "src/pages", outFile: "src/paths.gen.ts" })] },
 * })
 * ```
 *
 * @public
 */

export { defineConfig, type Config } from "waku/config";
