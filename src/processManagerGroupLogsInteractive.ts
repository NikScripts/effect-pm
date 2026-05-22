import { Deferred, Effect, Option, Queue, Ref, Stream } from "effect";
import type { HttpClient } from "effect/unstable/http";
import * as Terminal from "effect/Terminal";
import {
  groupLogEntryStream,
  ProcessManagerGroupLogError,
  type ProcessManagerGroupLogOptions,
} from "./processManagerGroupLogs.js";
import type { ProcessManagerLogScope } from "./processManagerLogContext.js";
import { logEntryMatchesScope } from "./processManagerLogContext.js";
import type { ProcessManagerLogEntry } from "./processManagerLogEntry.js";
import { replayLogEntry } from "./processManagerLogRelay.js";

const defaultPreludeLines = 100;
const maxPreludeLines = 500;

/**
 * Options for {@link watchGroupLogs}.
 *
 * @public
 */
export interface ProcessManagerGroupLogWatchOptions {
  readonly controlBaseUrl: string;
  /** Recent in-memory lines from relay snapshot before live tail (capped at relay history). */
  readonly preludeLines?: number;
  /** When false, stream entries to the logger without TTY key handling. */
  readonly interactive?: boolean;
  /** When false, read snapshot only (HTTP without follow) and exit. */
  readonly live?: boolean;
  /** When set, only replay entries matching this scope (process / queue / group). */
  readonly scope?: ProcessManagerLogScope;
}

const clampPreludeLines = (lines: number | undefined): number => {
  const value = lines ?? defaultPreludeLines;
  if (value < 0) {
    return 0;
  }
  return value > maxPreludeLines ? maxPreludeLines : value;
};

const helpText = [
  "Keys: f freeze/unfreeze live output, ? help, q quit (Ctrl+C also quits)",
  "Frozen lines are buffered and replayed when unfrozen.",
].join("\n");

const displayText = (
  terminal: Terminal.Terminal,
  text: string,
): Effect.Effect<void, ProcessManagerGroupLogError> =>
  terminal.display(text).pipe(
    Effect.mapError(
      (error) =>
        new ProcessManagerGroupLogError({
          reason: `Terminal display failed: ${String(error)}`,
        }),
    ),
  );

const isQuitInput = (input: Terminal.UserInput): boolean =>
  input.key.ctrl && input.key.name === "c";

const characterInput = (input: Terminal.UserInput): string | undefined =>
  Option.isSome(input.input) ? input.input.value : undefined;

const drainBuffer = (
  buffer: Queue.Queue<ProcessManagerLogEntry>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const entries = yield* Queue.takeAll(buffer);
    for (const entry of entries) {
      yield* replayLogEntry(entry);
    }
  });

const shouldReplay = (
  entry: ProcessManagerLogEntry,
  scope: ProcessManagerLogScope | undefined,
): boolean => scope === undefined || logEntryMatchesScope(entry, scope);

const runInteractiveWatch = (
  streamOptions: ProcessManagerGroupLogOptions,
  scope: ProcessManagerLogScope | undefined,
): Effect.Effect<void, ProcessManagerGroupLogError, HttpClient.HttpClient | Terminal.Terminal> =>
  Effect.scoped(
    Effect.gen(function* () {
      const terminal = yield* Terminal.Terminal;
      yield* displayText(
        terminal,
        `Watching structured logs from ${streamOptions.controlBaseUrl}\n${helpText}\n\n`,
      );

      const frozen = yield* Ref.make(false);
      const buffer = yield* Queue.unbounded<ProcessManagerLogEntry>();
      const shutdown = yield* Deferred.make<void, ProcessManagerGroupLogError>();
      let preludeRemaining = streamOptions.preludeLines ?? defaultPreludeLines;
      let liveBannerShown = preludeRemaining === 0;

      const showLiveBanner = Effect.gen(function* () {
        if (!liveBannerShown) {
          liveBannerShown = true;
          yield* displayText(terminal, "\n— live —\n\n");
        }
      });

      const handleEntry = (entry: ProcessManagerLogEntry): Effect.Effect<void, ProcessManagerGroupLogError> =>
        Effect.gen(function* () {
          if (!shouldReplay(entry, scope)) {
            return;
          }
          if (preludeRemaining > 0) {
            preludeRemaining -= 1;
            yield* replayLogEntry(entry);
            if (preludeRemaining === 0) {
              yield* showLiveBanner;
            }
            return;
          }
          yield* showLiveBanner;
          if (yield* Ref.get(frozen)) {
            yield* Queue.offer(buffer, entry);
            return;
          }
          yield* replayLogEntry(entry);
        });

      const streamEffect = groupLogEntryStream(streamOptions).pipe(
        Stream.runForEach(handleEntry),
        Effect.tap(() => Deferred.complete(shutdown, Effect.void)),
        Effect.catch((error: ProcessManagerGroupLogError) =>
          Deferred.fail(shutdown, error).pipe(Effect.asVoid),
        ),
      );

      const input = yield* terminal.readInput;
      const inputEffect = Effect.forever(
        Effect.gen(function* () {
          const event = yield* Queue.take(input);
          const char = characterInput(event);
          if (isQuitInput(event) || char === "q") {
            yield* Deferred.complete(shutdown, Effect.void);
            return;
          }
          if (char === "?" || char === "h") {
            yield* displayText(terminal, `\n${helpText}\n\n`);
            return;
          }
          if (char === "f") {
            const next = !(yield* Ref.get(frozen));
            yield* Ref.set(frozen, next);
            yield* displayText(terminal, next ? "\n[frozen]\n\n" : "\n[live]\n\n");
            if (!next) {
              yield* drainBuffer(buffer);
            }
          }
        }),
      );

      yield* Effect.forkChild(inputEffect, { startImmediately: true });

      yield* Effect.race(streamEffect, Deferred.await(shutdown)).pipe(
        Effect.catchIf(Terminal.isQuitError, () => Effect.void),
      );
    }),
  );

/**
 * Default operator log UX: recent relay prelude + live follow. Uses an interactive
 * TTY session when {@link ProcessManagerGroupLogWatchOptions.interactive} is true.
 *
 * @public
 */
export const watchGroupLogs = (
  options: ProcessManagerGroupLogWatchOptions,
): Effect.Effect<
  void,
  ProcessManagerGroupLogError,
  HttpClient.HttpClient | Terminal.Terminal
> => {
  const preludeLines = clampPreludeLines(options.preludeLines);
  const live = options.live ?? true;
  const scope = options.scope;
  const streamOptions: ProcessManagerGroupLogOptions = {
    controlBaseUrl: options.controlBaseUrl,
    follow: live,
    preludeLines,
  };

  const replayIfMatching = (entry: ProcessManagerLogEntry): Effect.Effect<void> =>
    shouldReplay(entry, scope) ? replayLogEntry(entry) : Effect.void;

  if (!live) {
    return groupLogEntryStream(streamOptions).pipe(
      Stream.runForEach(replayIfMatching),
    );
  }

  if (options.interactive === false) {
    return groupLogEntryStream(streamOptions).pipe(
      Stream.runForEach(replayIfMatching),
    );
  }

  return runInteractiveWatch(streamOptions, scope);
};
