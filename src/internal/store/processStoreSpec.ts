/**
 * Built-in {@link Process} store contract.
 *
 * @module internal/store/processStoreSpec
 * @internal
 */

import { Schema } from "effect";
import {
  makeStoreContractValue,
  makeStoreShape,
  type ShapeNamespaceMembers,
  type StoreContractValue,
  type StoreShapeDef,
} from "./contractDef";
import type { StoreScopeTag } from "./registration";

/** Built-in `execution` row schema. @internal */
export const processExecutionRowSchema = Schema.Struct({
  processId: Schema.String,
  executionId: Schema.String,
  startedAt: Schema.DateTimeUtc,
});

/** Read payload for built-in `execution` / `executions` queries. @internal */
export const processExecutionReadPayload = Schema.Struct({
  limit: Schema.optional(Schema.Number),
});

/** Part 1 shapes on the built-in process store contract. @internal */
export type ProcessBuiltInShapes = {
  readonly execution: StoreShapeDef<
    typeof processExecutionRowSchema,
    typeof processExecutionReadPayload
  >;
};

/** Part 2 custom aliases on the built-in process store contract. @internal */
export type ProcessBuiltInCustom = {
  readonly recordExecution: ShapeNamespaceMembers<
    typeof processExecutionRowSchema,
    typeof processExecutionReadPayload
  >["append"];
  readonly executions: ShapeNamespaceMembers<
    typeof processExecutionRowSchema,
    typeof processExecutionReadPayload
  >["read"];
};

/** Built-in process store contract. @internal */
export type BuiltInProcessContract = StoreContractValue<
  ProcessBuiltInShapes,
  ProcessBuiltInCustom
>;

/** @internal */
export const builtInProcessStoreContract = (
  _tag: StoreScopeTag,
): BuiltInProcessContract =>
  makeStoreContractValue(
    {
      execution: makeStoreShape(processExecutionRowSchema, processExecutionReadPayload),
    },
    ({ execution }) => ({
      recordExecution: execution.append,
      executions: execution.read,
    }),
  ) as unknown as BuiltInProcessContract;

/** @deprecated Internal flat spec — use {@link builtInProcessStoreContract}. @internal */
export const builtInProcessStoreSpec = (tag: StoreScopeTag) =>
  builtInProcessStoreContract(tag).spec;
