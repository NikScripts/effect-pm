/**
 * Concrete repo checks owned by `hyp`.
 *
 * Keep the argv lists here — `package.json` scripts are thin aliases that
 * call into this tree, not the other way around. Examples stay out until
 * rewritten one by one.
 */
import { Effect } from "effect";
import { run } from "./run";

/** `pnpm install --frozen-lockfile` */
export const deps = () => run("pnpm", ["install", "--frozen-lockfile"]);

/**
 * Full typecheck gate: tsgo (root + strict-provide + web) then tsc.
 * Mirrors the previous `pnpm typecheck` script body.
 */
export const typecheck = () =>
  Effect.gen(function* () {
    yield* run("tsgo", ["--noEmit", "-p", "tsconfig.json"]);
    yield* run("tsgo", ["--noEmit", "-p", "tsconfig.src.strict-effect-provide.json"]);
    yield* run("tsgo", ["--noEmit", "-p", "src/web/tsconfig.json"]);
    yield* run("tsc", ["--noEmit", "-p", "tsconfig.json"]);
  });

/** `vitest run` */
export const test = () => run("vitest", ["run"]);

/** `vitest` (watch mode). */
export const testWatch = () => run("vitest");

/** eslint over the package (repos/ ignored). */
export const lint = () => run("eslint", [".", "--ignore-pattern", "repos/**"]);

/** `tsup` */
export const build = () => run("tsup");

/** Remove build output (`dist/`). */
export const clean = () => run("rm", ["-rf", "dist"]);

/** Visibility marker check (baseline mode). */
export const markers = () =>
  run("tsx", ["scripts/mark-the-surface-check.ts", "--baseline"]);

/** Tag-only tree-shake smoke. */
export const treeshake = () => run("node", ["scripts/treeshake-check.mjs"]);

/** Standards manifest freshness (`docs/site`). */
export const manifest = () =>
  run("pnpm", ["-C", "docs/site", "docs:manifest:check"]);

/**
 * Default green gate for agents and CI.
 *
 * deps → typecheck → lint → test → build → markers.
 *
 * Matches working-agreement green-before-commit, plus deps + markers.
 * `treeshake` stays opt-in (`hyp check treeshake`).
 * `manifest` stays opt-in — it needs a separate `docs/site` install
 * (`hyp docs install` then `hyp check manifest` / `hyp docs manifest check`).
 */
export const verify = () =>
  Effect.gen(function* () {
    yield* deps();
    yield* typecheck();
    yield* lint();
    yield* test();
    yield* build();
    yield* markers();
  });
