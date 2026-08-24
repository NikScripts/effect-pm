/**
 * Implicit durable `_logs` shape on toolkit store contracts.
 *
 * Underscore-prefixed like Effect private fields: present on the runtime handle for
 * followers / internal reads, omitted from {@link StoreHandleFromContract} / public
 * {@link ShapeHandles} so apps can own a shape named `log`.
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

/**
 * Reserved platform journal shape key — do not document as app API.
 *
 * @internal
 */
export const IMPLICIT_LOGS_SHAPE_KEY = "_logs" as const;

type ImplicitLogShape = {
  readonly [IMPLICIT_LOGS_SHAPE_KEY]: StoreShapeDef<typeof LogEntrySchema>;
};

/**
 * Extend a store contract with bare {@link LogEntrySchema} under {@link IMPLICIT_LOGS_SHAPE_KEY}.
 *
 * Toolkit `*.store(tag)` registrations get this so durable tails can append privately.
 *
 * @internal
 */
export const withImplicitLogShape = <const C extends StoreContractValue>(
  contract: C,
): StoreContractValue<C["shapes"] & ImplicitLogShape, C["custom"]> =>
  mergeStoreContracts(contract, {
    [IMPLICIT_LOGS_SHAPE_KEY]: makeStoreShape(LogEntrySchema),
  });

/**
 * `true` when `contract.shapes._logs` is the bare {@link LogEntrySchema} (implicit tail shape).
 *
 * @internal
 */
export const hasImplicitLogShape = (
  contract: StoreContractValue | undefined,
): boolean => {
  if (contract === undefined) {
    return false;
  }
  const logs = contract.shapes[IMPLICIT_LOGS_SHAPE_KEY];
  if (logs === undefined || !isStoreShapeLeaf(logs)) {
    return false;
  }
  const row = isStoreShapeDef(logs) ? logs.row : logs;
  return row === LogEntrySchema;
};
