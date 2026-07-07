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
import { resultSchemaOf } from "../processTagSchemas";
import * as Store from "../../Store";
import type { StoreContractValue, StoreShapeDef } from "./contractDef";
import type { StoreScopeTag } from "./registration";

/** Execution event type for a void process. @internal */
export type ProcessExecutionEventVoid = typeof processExecutionEventVoid.Type;

/** Built-in process store contract — one `event` shape. @internal */
export type BuiltInProcessContract<R extends Schema.Top | void = void> =
  StoreContractValue<
    {
      readonly event: StoreShapeDef<
        R extends Schema.Top
          ? ReturnType<typeof makeProcessExecutionEvent<R>>
          : typeof processExecutionEventVoid,
        typeof processEventReadPayload
      >;
    },
    {
      readonly record: (
        event: R extends Schema.Top
          ? ReturnType<typeof makeProcessExecutionEvent<R>>["Type"]
          : ProcessExecutionEventVoid,
      ) => Effect.Effect<void>;
      readonly events: (
        payload?: { readonly limit?: number },
      ) => Effect.Effect<
        ReadonlyArray<
          R extends Schema.Top
            ? ReturnType<typeof makeProcessExecutionEvent<R>>["Type"]
            : ProcessExecutionEventVoid
        >
      >;
      readonly hasPriorExecutions: () => Effect.Effect<boolean>;
    }
  >;

/** Build the process store contract (optional result schema). @internal */
export const makeProcessStoreContract = <R extends Schema.Top | void = void>(
  resultSchema?: R extends Schema.Top ? R : never,
) => {
  const eventSchema =
    resultSchema === undefined
      ? processExecutionEventVoid
      : makeProcessExecutionEvent(resultSchema);

  return Store.contract(
    {
      event: Store.shape(eventSchema, processEventReadPayload),
    },
    ({ event }) => ({
      record: event.append,
      events: event.read,
      hasPriorExecutions: () =>
        Effect.map(event.read({ limit: 1 }), (rows) => rows.length > 0),
    }),
  );
};

/** Built-in process store contract for a tag (reads `resultSchema` from tag). @internal */
export const builtInProcessStoreContract = (
  tag: StoreScopeTag,
): BuiltInProcessContract =>
  makeProcessStoreContract(resultSchemaOf(tag)) as BuiltInProcessContract;

/** @deprecated Internal flat spec — use {@link builtInProcessStoreContract}. @internal */
export const builtInProcessStoreSpec = (tag: StoreScopeTag) =>
  builtInProcessStoreContract(tag).spec;
