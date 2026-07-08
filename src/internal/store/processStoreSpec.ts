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
import type { StoreContractValue, StoreShapeDef } from "./contractDef";
import type { StoreWriteError } from "./errors";
import type { StoreScopeTag } from "./registration";

/** Row accepted by the built-in process store handle (schema validates on append). @internal */
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

/** Built-in process store contract — one `event` shape. @internal */
export type BuiltInProcessContract = StoreContractValue<
  {
    readonly event: StoreShapeDef<
      Schema.Schema<unknown>,
      typeof processEventReadPayload
    >;
  },
  {
    readonly record: (event: ProcessStoreEventRow) => Effect.Effect<void, StoreWriteError>;
    readonly events: (
      payload?: { readonly limit?: number },
    ) => Effect.Effect<ReadonlyArray<ProcessStoreEventRow>>;
    readonly hasPriorExecutions: () => Effect.Effect<boolean>;
  }
>;

/** Build the process store contract (optional success / error schemas). @internal */
export const makeProcessStoreContract = (
  success?: Schema.Top,
  error?: Schema.Top,
): BuiltInProcessContract =>
  Store.contract(
    {
      event: Store.shape(
        success === undefined && error === undefined
          ? processExecutionEventVoid
          : makeProcessExecutionEvent(success, error),
        processEventReadPayload,
      ),
    },
    ({ event }) => ({
      record: event.append,
      events: event.read,
      hasPriorExecutions: () =>
        Effect.map(event.read({ limit: 1 }), (rows) => rows.length > 0),
    }),
  ) as BuiltInProcessContract;

/** Built-in process store contract for a tag (reads `success` / `error` from tag). @internal */
export const builtInProcessStoreContract = (
  tag: StoreScopeTag,
): BuiltInProcessContract =>
  makeProcessStoreContract(successOf(tag), errorOf(tag));

/** @deprecated Internal flat spec — use {@link builtInProcessStoreContract}. @internal */
export const builtInProcessStoreSpec = (tag: StoreScopeTag) =>
  builtInProcessStoreContract(tag).spec;
