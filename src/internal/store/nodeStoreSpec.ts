/**
 * Built-in store contract for {@link Resource.Node} registrations — durable log journal only.
 *
 * @module internal/store/nodeStoreSpec
 * @internal
 */

import { makeStoreContractValue } from "./contractDef";
import { withImplicitLogShape } from "./logShapes";

/**
 * Empty shapes + implicit {@link LogEntry} `_logs` — node-wide durable journal.
 *
 * @internal
 */
export const builtInNodeStoreContract = () =>
  withImplicitLogShape(makeStoreContractValue({}));

/** @internal */
export type NodeStoreContract = ReturnType<typeof builtInNodeStoreContract>;
