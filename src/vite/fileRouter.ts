/**
 * @module vite/fileRouter
 *
 * Invisible file-router codegen — watch `pages/**`, atomically rewrite
 * `paths.gen.ts` so typed `FilePath` / `Route.fileRoot` stay aligned while `dev`
 * runs. Same emit on `buildStart`.
 *
 * ```ts
 * // vite.config.ts / waku.config.ts
 * import { fileRouter } from "hyperlink-ts/vite"
 *
 * plugins: [
 *   fileRouter({
 *     pagesDir: "src/pages",
 *     outFile: "src/paths.gen.ts",
 *   }),
 * ]
 * ```
 *
 * CI: `hyp file-router check --pages … --out …` (same emit, fail if dirty).
 */
import type { Plugin } from "vite";
import * as NodePath from "node:path";
import { checkPaths, emitPaths } from "../internal/fileRouterPaths";

export type FileRouterPluginOptions = {
  /** Pages directory to walk (relative to Vite root or absolute). */
  readonly pagesDir: string;
  /** Generated module path (relative to Vite root or absolute). */
  readonly outFile: string;
  /**
   * When true, `buildStart` fails if `outFile` would change (CI / verify).
   * Default false — emit instead.
   */
  readonly check?: boolean;
};

const resolveFromRoot = (root: string, p: string): string =>
  NodePath.isAbsolute(p) ? p : NodePath.resolve(root, p);

/**
 * Vite plugin — watch + atomic `paths.gen.ts` emit.
 *
 * @public
 */
export const fileRouter = (options: FileRouterPluginOptions): Plugin => {
  let root = process.cwd();
  let pagesDir = options.pagesDir;
  let outFile = options.outFile;

  const runEmit = (log: (msg: string) => void): void => {
    const result = emitPaths({ pagesDir, outFile });
    if (result.changed) {
      log(
        `[hyperlink-ts] file-router: wrote ${NodePath.relative(root, outFile)} (${result.entries.length} paths)`,
      );
    }
  };

  return {
    name: "hyperlink-ts-file-router",
    configResolved(config) {
      root = config.root;
      pagesDir = resolveFromRoot(root, options.pagesDir);
      outFile = resolveFromRoot(root, options.outFile);
    },
    buildStart() {
      if (options.check === true) {
        checkPaths({ pagesDir, outFile });
        return;
      }
      runEmit((msg) => {
        this.info(msg);
      });
    },
    configureServer(server) {
      runEmit((msg) => {
        server.config.logger.info(msg);
      });
      const watchGlob = NodePath.join(pagesDir, "**/*");
      server.watcher.add(watchGlob);
      const onFs = (file: string): void => {
        const abs = NodePath.resolve(file);
        if (!abs.startsWith(pagesDir)) return;
        if (abs === outFile) return;
        runEmit((msg) => {
          server.config.logger.info(msg);
        });
      };
      server.watcher.on("add", onFs);
      server.watcher.on("unlink", onFs);
      server.watcher.on("change", onFs);
    },
  };
};

export { checkPaths, discover, emitPaths } from "../internal/fileRouterPaths";
