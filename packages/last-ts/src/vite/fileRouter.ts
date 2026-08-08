/**
 * @module vite
 *
 * Invisible file-router codegen — watch `pages/**`, atomically rewrite
 * `paths.gen.ts` so typed `FilePath` / route tables stay aligned while `dev`
 * runs. Same emit on `buildStart`.
 *
 * ```ts
 * // vite.config.ts / waku.config.ts
 * import { fileRouter } from "last-ts/vite"
 *
 * plugins: [
 *   fileRouter({
 *     pagesDir: "src/pages",
 *     outFile: "src/paths.gen.ts",
 *   }),
 * ]
 * ```
 *
 * CI: emit/check via the same helpers (repo `hyp file-router`, or package scripts).
 */
import type { Plugin } from "vite";
import { Effect } from "effect";
import * as Path from "effect/Path";
import {
  checkPaths,
  emitPaths,
  runPromise,
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

const resolveFromRoot = (root: string, p: string): Promise<string> =>
  runPromise(
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

  const runEmit = async (log: (msg: string) => void): Promise<void> => {
    const result = await runPromise(emitPaths({ pagesDir, outFile }));
    if (result.changed) {
      const rel = await runPromise(
        Effect.gen(function* () {
          const path = yield* Path.Path;
          return path.relative(root, outFile);
        }),
      );
      log(
        `[last-ts] file-router: wrote ${rel} (${result.entries.length} paths)`,
      );
    }
  };

  return {
    name: "last-ts-file-router",
    async configResolved(config) {
      root = config.root;
      pagesDir = await resolveFromRoot(root, options.pagesDir);
      outFile = await resolveFromRoot(root, options.outFile);
    },
    async buildStart() {
      if (options.check === true) {
        await runPromise(checkPaths({ pagesDir, outFile }));
        return;
      }
      await runEmit((msg) => {
        this.info(msg);
      });
    },
    async configureServer(server) {
      await runEmit((msg) => {
        server.config.logger.info(msg);
      });
      const watchGlob = await runPromise(
        Effect.gen(function* () {
          const path = yield* Path.Path;
          return path.join(pagesDir, "**/*");
        }),
      );
      server.watcher.add(watchGlob);
      const onFs = (file: string): void => {
        void (async () => {
          const abs = await runPromise(
            Effect.gen(function* () {
              const path = yield* Path.Path;
              return path.resolve(file);
            }),
          );
          if (!abs.startsWith(pagesDir)) return;
          if (abs === outFile) return;
          await runEmit((msg) => {
            server.config.logger.info(msg);
          });
        })();
      };
      server.watcher.on("add", onFs);
      server.watcher.on("unlink", onFs);
      server.watcher.on("change", onFs);
    },
  };
};

export {
  PathsMissingError,
  PathsStaleError,
  checkPaths,
  discover,
  emitPaths,
  formatPathsModule,
  nodeLayer,
  runPromise,
  runSync,
  toFilePath,
  toRouteId,
  toRoutePath,
  writeAtomic,
  type EmitOptions,
  type FileEntry,
  type FileRouterServices,
} from "../internal/fileRouterPaths";
