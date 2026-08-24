/**
 * Docs-site commands owned by `hyp docs …`.
 */
import { run } from "./run";

const pnpmDocs = (script: string) => run("pnpm", ["-C", "docs/site", script]);

/** `pnpm -C docs/site install` */
export const install = () => run("pnpm", ["-C", "docs/site", "install"]);

/** Local docs dev server. */
export const serve = () => pnpmDocs("dev");

/** Production docs build. */
export const build = () => pnpmDocs("build");

/** Preview the built docs site. */
export const preview = () => pnpmDocs("preview");

/** Regenerate `docs/standards/manifest.json`. */
export const manifest = () => pnpmDocs("docs:manifest");

/** Fail if the standards manifest is stale. */
export const manifestCheck = () => pnpmDocs("docs:manifest:check");
