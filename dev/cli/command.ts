/**
 * `hyp` — Effect CLI command tree for repo / developer gates.
 *
 * This is **not** the published `hyperlink-ts/cli` resource CLI. That one
 * composes app tags; this one owns typecheck, lint, test, verify, docs, etc.
 * Examples stay out of this tree until rewritten one by one.
 */
import { Command, Flag } from "effect/unstable/cli";
import * as checks from "./checks";
import * as docs from "./docs";

const checkDeps = Command.make("deps").pipe(
  Command.withDescription("Frozen lockfile install (`pnpm install --frozen-lockfile`)."),
  Command.withHandler(() => checks.deps()),
);

const checkTypecheck = Command.make("typecheck").pipe(
  Command.withDescription("tsgo (root + strict-provide + ui + web + tui) then tsc."),
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
    "Default green gate: deps → typecheck → lint → test → build → markers.",
  ),
  Command.withHandler(() => checks.verify()),
);

const typecheck = Command.make("typecheck").pipe(
  Command.withDescription("Same as `hyp check typecheck`."),
  Command.withHandler(() => checks.typecheck()),
);

const test = Command.make("test", {
  watch: Flag.boolean("watch").pipe(
    Flag.withAlias("w"),
    Flag.withDescription("Watch mode (`vitest` instead of `vitest run`)."),
    Flag.withDefault(false),
  ),
}).pipe(
  Command.withDescription("Same as `hyp check test` (pass `--watch` for vitest watch)."),
  Command.withHandler(({ watch }) => (watch ? checks.testWatch() : checks.test())),
);

const lint = Command.make("lint").pipe(
  Command.withDescription("Same as `hyp check lint`."),
  Command.withHandler(() => checks.lint()),
);

const build = Command.make("build").pipe(
  Command.withDescription("Same as `hyp check build`."),
  Command.withHandler(() => checks.build()),
);

const clean = Command.make("clean").pipe(
  Command.withDescription("Remove `dist/`."),
  Command.withHandler(() => checks.clean()),
);

const docsInstall = Command.make("install").pipe(
  Command.withDescription("Install docs-site dependencies."),
  Command.withHandler(() => docs.install()),
);

const docsServe = Command.make("serve").pipe(
  Command.withDescription("Docs site dev server (`docs/site` waku)."),
  Command.withHandler(() => docs.serve()),
);

const docsBuild = Command.make("build").pipe(
  Command.withDescription("Build the docs site."),
  Command.withHandler(() => docs.build()),
);

const docsPreview = Command.make("preview").pipe(
  Command.withDescription("Preview the built docs site."),
  Command.withHandler(() => docs.preview()),
);

const docsManifestGenerate = Command.make("generate").pipe(
  Command.withDescription("Regenerate `docs/standards/manifest.json`."),
  Command.withHandler(() => docs.manifest()),
);

const docsManifestCheck = Command.make("check").pipe(
  Command.withDescription("Fail if the standards manifest is stale."),
  Command.withHandler(() => docs.manifestCheck()),
);

const docsManifest = Command.make("manifest").pipe(
  Command.withDescription("Standards manifest generate / freshness check."),
  Command.withSubcommands([docsManifestGenerate, docsManifestCheck]),
);

const docsCommand = Command.make("docs").pipe(
  Command.withDescription("Docs-site developer commands."),
  Command.withSubcommands([
    docsInstall,
    docsServe,
    docsBuild,
    docsPreview,
    docsManifest,
  ]),
);

/**
 * Root `hyp` command.
 */
export const hyp = Command.make("hyp").pipe(
  Command.withDescription(
    "Hyperlink repo CLI — developer gates (verify, typecheck, lint, test, docs, …).",
  ),
  Command.withSubcommands([
    verify,
    check,
    typecheck,
    test,
    lint,
    build,
    clean,
    docsCommand,
  ]),
);
