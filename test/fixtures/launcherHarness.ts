/**
 * Shared helpers for `Launcher` runtime tests.
 */
import { Effect, Schema } from "effect";
import { ChildProcess } from "effect/unstable/process";
import * as Hyperlink from "../../src/Hyperlink";
import * as Launcher from "../../src/Launcher";

export const platform = Launcher.layer;

/** Matches the HyperService served by `launcher-child-serve.ts`. */
export class ChildJobs extends Hyperlink.Service<ChildJobs>()(
  "launcher-child/Jobs",
  {
    ping: Hyperlink.effect(Schema.String),
  },
) {}

export const childEntryPaths = () => {
  const root = new URL("../..", import.meta.url).pathname;
  return {
    root,
    entry: `${root}/test/fixtures/launcher-child-serve.ts`,
  };
};

/** Paths for `launcher-restart-child.ts` (Lookup-joined A→B cutover). */
export const restartChildEntryPaths = () => {
  const root = new URL("../..", import.meta.url).pathname;
  return {
    root,
    entry: `${root}/test/fixtures/launcher-restart-child.ts`,
  };
};

export const ephemeralPort = (tokenHex: string, salt = 0): number =>
  20_000 + ((Number.parseInt(tokenHex.slice(0, 4), 16) + salt) % 10_000);

/** Best-effort reap of leftover fixture children (no matches is fine). */
export const reapLauncherChildren = ChildProcess.make("pkill", [
  "-f",
  "test/fixtures/launcher-child-serve.ts",
]).pipe(
  Effect.flatMap((h) => h.exitCode),
  Effect.ignore,
);

/** Best-effort reap of restart-successor fixture children. */
export const reapRestartChildren = ChildProcess.make("pkill", [
  "-f",
  "test/fixtures/launcher-restart-child.ts",
]).pipe(
  Effect.flatMap((h) => h.exitCode),
  Effect.ignore,
);

export const childArgvProcess = (
  root: string,
  entry: string,
  port: number,
) =>
  Launcher.command("pnpm", ["exec", "tsx", entry, String(port)], {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
    token: "argv",
  });

/** Narrow a StandardCommand for sync factory assertions. */
export const asStandard = (
  built: ChildProcess.Command,
): ChildProcess.StandardCommand => {
  if (!ChildProcess.isStandardCommand(built)) {
    throw new Error("expected StandardCommand");
  }
  return built;
};
