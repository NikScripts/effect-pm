/**
 * `hl` — Effect CLI command tree for repo / developer gates.
 *
 * This is **not** the published `hyperlink-ts/cli` resource CLI. That one
 * composes app tags; this one owns typecheck, lint, test, verify, etc.
 */
import { Command } from "effect/unstable/cli";
import * as checks from "./checks";

const checkDeps = Command.make("deps").pipe(
  Command.withDescription("Frozen lockfile install (`pnpm install --frozen-lockfile`)."),
  Command.withHandler(() => checks.deps()),
);

const checkTypecheck = Command.make("typecheck").pipe(
  Command.withDescription("tsgo (root + strict-provide + web) then tsc."),
  Command.withHandler(() => checks.typecheck()),
);

const checkTest = Command.make("test").pipe(
  Command.withDescription("vitest run."),
  Command.withHandler(() => checks.test()),
);

const checkLint = Command.make("lint").pipe(
  Command.withDescription("eslint over the repo (repos/ ignored)."),
  Command.withHandler(() => checks.lint()),
);

const checkBuild = Command.make("build").pipe(
  Command.withDescription("tsup build."),
  Command.withHandler(() => checks.build()),
);

const checkMarkers = Command.make("markers").pipe(
  Command.withDescription("mark-the-surface visibility check (baseline mode)."),
  Command.withHandler(() => checks.markers()),
);

const checkTreeshake = Command.make("treeshake").pipe(
  Command.withDescription("Tag-only tree-shake smoke (`scripts/treeshake-check.mjs`)."),
  Command.withHandler(() => checks.treeshake()),
);

const checkManifest = Command.make("manifest").pipe(
  Command.withDescription("Standards manifest freshness (`docs:manifest:check`)."),
  Command.withHandler(() => checks.manifest()),
);

const check = Command.make("check").pipe(
  Command.withDescription("Individual gates (deps, typecheck, lint, test, …)."),
  Command.withSubcommands([
    checkDeps,
    checkTypecheck,
    checkTest,
    checkLint,
    checkBuild,
    checkMarkers,
    checkTreeshake,
    checkManifest,
  ]),
);

const verify = Command.make("verify").pipe(
  Command.withDescription(
    "Default green gate: deps → typecheck → lint → test → markers.",
  ),
  Command.withHandler(() => checks.verify()),
);

const typecheck = Command.make("typecheck").pipe(
  Command.withDescription("Same as `hl check typecheck`."),
  Command.withHandler(() => checks.typecheck()),
);

const test = Command.make("test").pipe(
  Command.withDescription("Same as `hl check test`."),
  Command.withHandler(() => checks.test()),
);

const lint = Command.make("lint").pipe(
  Command.withDescription("Same as `hl check lint`."),
  Command.withHandler(() => checks.lint()),
);

const build = Command.make("build").pipe(
  Command.withDescription("Same as `hl check build`."),
  Command.withHandler(() => checks.build()),
);

/**
 * Root `hl` command.
 */
export const hl = Command.make("hl").pipe(
  Command.withDescription(
    "Hyperlink repo CLI — developer gates (verify, typecheck, lint, test, …).",
  ),
  Command.withSubcommands([verify, check, typecheck, test, lint, build]),
);
