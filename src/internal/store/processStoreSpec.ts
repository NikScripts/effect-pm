/**
 * Built-in {@link Process} store contract.
 *
 * Persists the same execution event union the supervisor emits at run terminal
 * (`record` / `events`), aligned with {@link builtInQueueStoreContract}.
 *
 * @module internal/store/processStoreSpec
 * @internal
 */

import { Effect } from "effect";
import type { Schema } from "effect";
import {
  makeProcessExecutionEvent,
  processEventReadPayload,
  processExecutionEventVoid,
} from "../processEvent";
import { errorOf, successOf } from "../processTagSchemas";
import * as Store from "../../Store";
import type { StoreScopeTag } from "./registration";

/** Row accepted by the built-in process store tap; journal encodes on append. @internal */
export type ProcessStoreEventRow = {
  readonly _tag: "RunCompleted" | "RunFailed" | "RunInterrupted";
  readonly processId: string;
  readonly scheduleKey: string | null;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly durationMs: number;
  readonly isStartupRun: boolean;
  readonly success?: unknown;
  readonly error?: unknown;
};

const processEventSchema = (
  success?: Schema.Top,
  error?: Schema.Top,
) =>
  success === undefined && error === undefined
    ? processExecutionEventVoid
    : makeProcessExecutionEvent(success, error);

/** Event union schema for a process store contract. @internal */
export const processStoreEventSchema = processEventSchema;

/** Built-in process store contract — one `event` shape. @internal */
export type BuiltInProcessContract = ReturnType<typeof makeProcessStoreContract>;

/** Build the process store contract (optional success / error schemas). @internal */
export const makeProcessStoreContract = (
  success?: Schema.Top,
  error?: Schema.Top,
) =>
  Store.contract(
    {
      event: Store.shape(processEventSchema(success, error), processEventReadPayload),
    },
    ({ event }) => {
      const appendRow = event.append as (
        row: ProcessStoreEventRow,
      ) => Effect.Effect<void>;
      return {
        record: appendRow,
        events: event.read,
        hasPriorExecutions: () =>
          Effect.map(event.read({ limit: 1 }), (rows) => rows.length > 0),
      };
    },
  );

/** Built-in process store contract for a tag (reads `success` / `error` from tag). @internal */
export const builtInProcessStoreContract = (
  tag: StoreScopeTag,
): BuiltInProcessContract =>
  makeProcessStoreContract(successOf(tag), errorOf(tag));

/** @deprecated Internal flat spec — use {@link builtInProcessStoreContract}. @internal */
export const builtInProcessStoreSpec = (tag: StoreScopeTag) =>
  builtInProcessStoreContract(tag).spec;
