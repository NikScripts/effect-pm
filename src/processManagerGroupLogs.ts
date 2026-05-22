import { Console, Effect, FileSystem, Ref, Schedule } from "effect";

/**
 * Resolved stdout/stderr log file paths for a running group child.
 *
 * @public
 */
export interface ProcessManagerGroupLogPaths {
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * @public
 */
export type ProcessManagerGroupLogStream = "both" | "stdout" | "stderr";

/**
 * Options for {@link streamGroupLogs}.
 *
 * @public
 */
export interface ProcessManagerGroupLogOptions {
  readonly paths: ProcessManagerGroupLogPaths;
  readonly lines: number;
  readonly follow: boolean;
  readonly stream: ProcessManagerGroupLogStream;
}

const textDecoder = new TextDecoder();

/** @internal */
export const tailTextLines = (text: string, maxLines: number): string => {
  if (maxLines <= 0 || text.length === 0) {
    return "";
  }
  const normalized = text.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n");
  const body = parts.at(-1) === "" ? parts.slice(0, -1) : parts;
  if (body.length === 0) {
    return "";
  }
  const slice = body.length <= maxLines ? body : body.slice(body.length - maxLines);
  return `${slice.join("\n")}\n`;
};

const readFileBytes = (
  path: string,
): Effect.Effect<Uint8Array, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const exists = yield* fs.exists(path).pipe(Effect.orElseSucceed(() => false));
    if (!exists) {
      return new Uint8Array();
    }
    return yield* fs.readFile(path).pipe(Effect.orElseSucceed(() => new Uint8Array()));
  });

/** @internal */
export const readLogBytesSince = (
  path: string,
  offset: number,
): Effect.Effect<
  { readonly text: string; readonly nextOffset: number },
  never,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const bytes = yield* readFileBytes(path);
    if (bytes.byteLength <= offset) {
      return { text: "", nextOffset: offset };
    }
    return {
      text: textDecoder.decode(bytes.subarray(offset)),
      nextOffset: bytes.byteLength,
    };
  });

const logLines = (
  text: string,
  prefix: string,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (text.length === 0) {
      return;
    }
    const normalized = text.replace(/\r\n/g, "\n");
    const parts = normalized.split("\n");
    const incompleteLast = !normalized.endsWith("\n");
    const complete = incompleteLast ? parts.slice(0, -1) : parts;
    for (const line of complete) {
      yield* Console.log(`${prefix}${line}`);
    }
  });

const printInitialTail = (
  path: string,
  lines: number,
  prefix: string,
): Effect.Effect<number, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const bytes = yield* readFileBytes(path);
    const tail = tailTextLines(textDecoder.decode(bytes), lines);
    yield* logLines(tail, prefix);
    return bytes.byteLength;
  });

const followPath = (
  path: string,
  prefix: string,
  offsetRef: Ref.Ref<number>,
): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const append = yield* readLogBytesSince(path, yield* Ref.get(offsetRef));
    yield* Ref.set(offsetRef, append.nextOffset);
    yield* logLines(append.text, prefix);
  });

/**
 * Print the last `lines` of group log files and optionally follow new output.
 *
 * @public
 */
export const streamGroupLogs = (
  options: ProcessManagerGroupLogOptions,
): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const stdoutOffset = yield* Ref.make(0);
    const stderrOffset = yield* Ref.make(0);

    if (options.stream === "both" || options.stream === "stdout") {
      const next = yield* printInitialTail(
        options.paths.stdout,
        options.lines,
        options.stream === "both" ? "[stdout] " : "",
      );
      yield* Ref.set(stdoutOffset, next);
    }

    if (options.stream === "both" || options.stream === "stderr") {
      const next = yield* printInitialTail(
        options.paths.stderr,
        options.lines,
        options.stream === "both" ? "[stderr] " : "",
      );
      yield* Ref.set(stderrOffset, next);
    }

    if (!options.follow) {
      return;
    }

    const pollAppends = Effect.gen(function* () {
      if (options.stream === "both" || options.stream === "stdout") {
        yield* followPath(
          options.paths.stdout,
          options.stream === "both" ? "[stdout] " : "",
          stdoutOffset,
        );
      }
      if (options.stream === "both" || options.stream === "stderr") {
        yield* followPath(
          options.paths.stderr,
          options.stream === "both" ? "[stderr] " : "",
          stderrOffset,
        );
      }
    });

    yield* pollAppends.pipe(Effect.repeat(Schedule.spaced("200 millis")));
  });
