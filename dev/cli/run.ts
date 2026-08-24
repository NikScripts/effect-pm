/**
 * Spawn a repo tool with inherited stdio and fail on non-zero exit.
 *
 * Used by the `hyp` command tree so every check goes through Effect's
 * `ChildProcess` / `ChildProcessSpawner` instead of raw `node:child_process`.
 */
import { Data, Effect } from "effect";
import { ChildProcess } from "effect/unstable/process";
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";

/**
 * A child tool exited non-zero.
 */
export class CommandFailed extends Data.TaggedError("CommandFailed")<{
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly exitCode: number;
}> {}

/**
 * Run `command args…` in the repo root with inherited stdio.
 * Fails with {@link CommandFailed} when the exit code is non-zero.
 */
export const run = (command: string, args: ReadonlyArray<string> = []) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner;
    const exitCode = yield* spawner.exitCode(
      ChildProcess.make(command, args, {
        detached: false,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      }),
    );
    if (exitCode !== 0) {
      return yield* new CommandFailed({ command, args, exitCode });
    }
  });
