/**
 * Prisma-backed ProcessStore adapter placeholder.
 *
 * @remarks
 * Prefer this package subpath for future storage-specific imports:
 *
 * ```ts
 * import { PrismaProcessStore } from "@nikscripts/effect-pm/storage/prisma";
 * ```
 *
 * The legacy event-table adapter has been removed. Prisma will return as a
 * RuntimeStorage adapter over normalized RuntimeRecord rows.
 *
 * @module storage/prisma
 */

export {
  PrismaProcessStore,
  PrismaProcessStoreDecodeError,
  PrismaProcessStoreUnavailableError,
  decodeEventRow,
  encodeEvent,
} from "../prisma";

export type {
  EffectPmEventCreateInput,
  EffectPmEventDelegate,
  EffectPmEventRow,
  JsonValue,
  PrismaProcessStoreClient,
} from "../prisma";
