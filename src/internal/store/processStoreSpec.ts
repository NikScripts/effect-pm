/**
 * Built-in {@link Process} store spec.
 *
 * @remarks
 * Full facet parity (executions, lifecycle) lands with the process store migration.
 * This stub wires the registration shape; method names are stable extension points.
 *
 * @module internal/store/processStoreSpec
 * @internal
 */

import { Schema } from "effect";
import type { StoreScopeTag } from "./registration";
import { storeAppend, storeQuery } from "./builders";

/** @internal */
export const builtInProcessStoreSpec = (_tag: StoreScopeTag) => ({
  recordExecution: storeAppend(
    Schema.Struct({
      processId: Schema.String,
      executionId: Schema.String,
      startedAt: Schema.DateTimeUtc,
    }),
  ),
  executions: storeQuery({
    from: "recordExecution",
    payload: Schema.Struct({
      limit: Schema.optional(Schema.Number),
    }),
    result: Schema.Array(
      Schema.Struct({
        processId: Schema.String,
        executionId: Schema.String,
        startedAt: Schema.DateTimeUtc,
      }),
    ),
  }),
});
