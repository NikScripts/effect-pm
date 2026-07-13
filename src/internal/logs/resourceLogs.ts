/**
 * {@link Resource.logs} — per-resource log export surface.
 *
 * @module internal/logs/resourceLogs
 * @internal
 */

import { Effect, Stream } from "effect";
import type { LogEntry } from "../../LogEntry";
import * as Logs from "../../Logs";
import { LogQueryError } from "../manager/logQuery";
import type { StoreScopeTag } from "../store/registration";
import { LogStore } from "../../store/log";
import type { LogRelay } from "./relay";

/** Live + durable log export for one resource tag. @internal */
export interface LogsExportHandle {
  readonly stream: Stream.Stream<LogEntry, never, LogRelay>;
  readonly query: (
    options?: { readonly limit?: number },
  ) => Effect.Effect<ReadonlyArray<LogEntry>, never, LogStore>;
}

/**
 * Unfiltered relay stream + durable query scoped to `tag.key` lineage.
 *
 * @internal
 */
export const logs = <Tag extends StoreScopeTag>(
  tag: Tag,
): Effect.Effect<LogsExportHandle, never, LogRelay | LogStore> =>
  Effect.succeed({
    stream: Logs.stream,
    query: (options) =>
      Effect.flatMap(LogStore, (store) =>
        store.load({
          lineageContains: tag.key,
          limit: options?.limit ?? 200,
          sort: "desc",
        }),
      ).pipe(
        Effect.catchIf(
          (error): error is LogQueryError => error instanceof LogQueryError,
          () => Effect.succeed<ReadonlyArray<LogEntry>>([]),
        ),
        Effect.orDie,
      ),
  });

/**
 * Tag pipe combinator — adds `yield* Tag.logs` when export is enabled.
 *
 * @internal
 */
export const withLogExport =
  <Tag extends StoreScopeTag>(tag: Tag): Tag & { readonly logs: Effect.Effect<LogsExportHandle, never, LogRelay | LogStore> } =>
    Object.assign(tag, { logs: logs(tag) }) as Tag & {
      readonly logs: Effect.Effect<LogsExportHandle, never, LogRelay | LogStore>;
    };
