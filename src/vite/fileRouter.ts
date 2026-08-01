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
import { Effect } from "effect";
import * as Path from "effect/Path";
import {
  checkPaths,
  emitPaths,
  runSync,
} from "../internal/fileRouterPaths";

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
  runSync(
    Effect.gen(function* () {
      const path = yield* Path.Path;
      return path.isAbsolute(p) ? p : path.resolve(root, p);
    }),
  );

/**
 * Vite plugin — watch + atomic `paths.gen.ts` emit.
 *
 * @public
 */
export const fileRouter = (options: FileRouterPluginOptions): Plugin => {
  let root = ".";
  let pagesDir = options.pagesDir;
  let outFile = options.outFile;

  const runEmit = (log: (msg: string) => void): void => {
    const result = runSync(emitPaths({ pagesDir, outFile }));
    if (result.changed) {
      const rel = runSync(
        Effect.gen(function* () {
          const path = yield* Path.Path;
          return path.relative(root, outFile);
        }),
      );
      log(
        `[hyperlink-ts] file-router: wrote ${rel} (${result.entries.length} paths)`,
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
        runSync(checkPaths({ pagesDir, outFile }));
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
      const watchGlob = runSync(
        Effect.gen(function* () {
          const path = yield* Path.Path;
          return path.join(pagesDir, "**/*");
        }),
      );
      server.watcher.add(watchGlob);
      const onFs = (file: string): void => {
        const abs = runSync(
          Effect.gen(function* () {
            const path = yield* Path.Path;
            return path.resolve(file);
          }),
        );
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

export {
  checkPaths,
  discover,
  emitPaths,
  nodeLayer,
  runSync,
} from "../internal/fileRouterPaths";
