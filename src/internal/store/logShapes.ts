/**
 * Implicit durable `log` shape on toolkit store contracts.
 *
 * @module internal/store/logShapes
 * @internal
 */

import { LogEntrySchema } from "../../LogEntry";
import {
  isStoreShapeDef,
  isStoreShapeLeaf,
  makeStoreShape,
  mergeStoreContracts,
  type StoreContractValue,
  type StoreShapeDef,
} from "./contractDef";

type ImplicitLogShape = {
  readonly log: StoreShapeDef<typeof LogEntrySchema>;
};

/**
 * Extend a store contract with bare {@link LogEntrySchema} under shape key `log`.
 *
 * Toolkit `*.store(tag)` registrations get this so durable tails can `handle.log.append`.
 * Interim {@link LogStore} keeps its wrapped row schema and is **not** detected as implicit.
 *
 * @internal
 */
export const withImplicitLogShape = <const C extends StoreContractValue>(
  contract: C,
): StoreContractValue<C["shapes"] & ImplicitLogShape, C["custom"]> =>
  mergeStoreContracts(contract, {
    log: makeStoreShape(LogEntrySchema),
  });

/**
 * `true` when `contract.shapes.log` is the bare {@link LogEntrySchema} (implicit tail shape).
 *
 * @internal
 */
export const hasImplicitLogShape = (
  contract: StoreContractValue | undefined,
): boolean => {
  if (contract === undefined) {
    return false;
  }
  const log = contract.shapes["log"];
  if (log === undefined || !isStoreShapeLeaf(log)) {
    return false;
  }
  const row = isStoreShapeDef(log) ? log.row : log;
  return row === LogEntrySchema;
};
