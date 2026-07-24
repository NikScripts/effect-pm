/**
 * {@link Hyperlink.logs} — per-resource log export surface.
 *
 * @module internal/logs/hyperlinkLogs
 * @internal
 */

import { Effect, Option, Stream } from "effect";
import type { LogEntry } from "../../LogEntry";
import * as LogEntryModule from "../../LogEntry";
import { Storage } from "../../Store";
import { meetsStoreLevel } from "./durableTailPolicy";
import { queryDurableScope, readScopeLog } from "./durableRead";
import type { StoreScopeTag } from "../store/registration";
import { LogRelay } from "./relay";
import type { StoreLogLevel } from "../store/types";
import { streamLevelOf, type StreamLevelCarrier } from "./streamLevel";

/** Live + durable log export for one resource tag. @internal */
export interface LogsExportHandle {
  readonly stream: Stream.Stream<LogEntry, never, never>;
  readonly query: (
    options?: { readonly limit?: number },
  ) => Effect.Effect<ReadonlyArray<LogEntry>>;
}

const applyStreamGates = (
  source: Stream.Stream<LogEntry>,
  tagKey: string,
  floor: StoreLogLevel,
): Stream.Stream<LogEntry> => {
  const scoped = Stream.filter(source, LogEntryModule.hasKey(tagKey));
  return floor === "All" ? scoped : Stream.filter(scoped, meetsStoreLevel(floor));
};

/**
 * Durable rows for a resource. Prefers local registration Storage; on a remote client
 * (no local scope), falls back to {@link NodeStatus} `logs.query` filtered by lineage.
 *
 * @internal
 */
const queryResourceLogs = (
  tagKey: string,
  options?: { readonly limit?: number },
): Effect.Effect<ReadonlyArray<LogEntry>> => {
  const limit = options?.limit ?? 200;
  return Effect.gen(function* () {
    const local = yield* queryDurableScope(tagKey, { limit });
    const storage = yield* Effect.serviceOption(Storage);
    if (Option.isSome(storage)) {
      const registered = yield* readScopeLog(tagKey, limit).pipe(
        Effect.provideService(Storage, storage.value),
      );
      if (Option.isSome(registered)) {
        return local;
      }
    } else if (local.length > 0) {
      return local;
    }
    const { NodeStatusTag } = yield* Effect.promise(
      () => import("../nodeStatus"),
    );
    const status = yield* Effect.serviceOption(NodeStatusTag);
    if (Option.isNone(status)) {
      return local;
    }
    const rows = yield* status.value.logs.query({ limit });
    return rows.filter(LogEntryModule.hasKey(tagKey));
  });
};

/**
 * Live stream: lineage + optional {@link Hyperlink.logStreamLevel} gate.
 * Local {@link LogRelay} when present; otherwise NodeStatus.logs (remote client).
 * Durable `query` prefers registration Storage, else NodeStatus (remote).
 *
 * @internal
 */
export const logs = <Tag extends StoreScopeTag>(
  tag: Tag,
): Effect.Effect<LogsExportHandle, never, never> => {
  const floor = streamLevelOf(tag as Tag & StreamLevelCarrier);
  const stream = Stream.unwrap(
    Effect.gen(function* () {
      const relay = yield* Effect.serviceOption(LogRelay);
      if (Option.isSome(relay)) {
        const tail = yield* relay.value.snapshot;
        return applyStreamGates(
          Stream.concat(Stream.fromIterable(tail), relay.value.stream),
          tag.key,
          floor,
        );
      }
      const { NodeStatusTag } = yield* Effect.promise(
        () => import("../nodeStatus"),
      );
      const status = yield* Effect.serviceOption(NodeStatusTag);
      if (Option.isNone(status)) {
        return Stream.empty;
      }
      return applyStreamGates(status.value.logs.stream, tag.key, floor);
    }),
  );
  return Effect.succeed({
    stream,
    query: (options) => queryResourceLogs(tag.key, options),
  });
};

/**
 * Tag pipe combinator — adds `yield* Tag.logs` when export is enabled.
 *
 * @internal
 */
export const withLogExport = <Tag extends StoreScopeTag>(
  tag: Tag,
): Tag & { readonly logs: Effect.Effect<LogsExportHandle, never, never> } =>
  Object.assign(tag, { logs: logs(tag) }) as Tag & {
    readonly logs: Effect.Effect<LogsExportHandle, never, never>;
  };
