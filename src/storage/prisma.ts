/**
 * Prisma-backed RuntimeStorage adapter.
 *
 * @remarks
 * Use this storage subpath for Prisma-backed RuntimeStorage:
 *
 * ```ts
 * import { PrismaRuntimeStorage } from "@nikscripts/effect-pm/storage/prisma";
 * ```
 *
 * The adapter stores normalized {@link RuntimeRecord} rows through a structural
 * Prisma client supplied by the consuming application.
 *
 * @module storage/prisma
 */

export {
  PrismaRuntimeStorage,
} from "../prisma";

export type {
  EffectPmRuntimeRecordCreateInput,
  EffectPmRuntimeRecordDelegate,
  EffectPmRuntimeRecordFindManyArgs,
  EffectPmRuntimeRecordOrderByInput,
  EffectPmRuntimeRecordRow,
  EffectPmRuntimeRecordUpdateInput,
  EffectPmRuntimeRecordWhereInput,
  EffectPmRuntimeRecordWhereUniqueInput,
  JsonValue,
  PrismaRuntimeStorageClient,
} from "../prisma";
