/**
 * Unix-domain socket path hygiene for {@link Resource.ipcServer}.
 *
 * @internal
 */
import { Effect, FileSystem } from "effect";

/**
 * Best-effort remove of a listen path — missing path is fine so bind/listen can
 * report the real failure (e.g. still in use).
 *
 * @internal
 */
export const unlinkBestEffort = (
  path: string,
): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.flatMap(FileSystem.FileSystem, (fs) =>
    fs.remove(path, { force: true }).pipe(Effect.ignore, Effect.asVoid),
  );
