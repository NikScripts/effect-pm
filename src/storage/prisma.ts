/**
 * Prisma-backed ProcessStore adapter.
 *
 * @remarks
 * Prefer this package subpath for storage-specific imports:
 *
 * ```ts
 * import { PrismaProcessStore } from "@nikscripts/effect-pm/storage/prisma";
 * ```
 *
 * The legacy `@nikscripts/effect-pm/prisma` subpath remains available for
 * compatibility.
 *
 * @module storage/prisma
 */

export {
  PrismaProcessStore,
  PrismaProcessStoreDecodeError,
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
