/**
 * Public entry point for the Prisma-backed {@link ProcessStore} adapter.
 *
 * @remarks
 * Imported via the legacy package subpath:
 *
 * ```ts
 * import { PrismaProcessStore } from "@nikscripts/effect-pm/prisma";
 * ```
 *
 * New code can prefer `@nikscripts/effect-pm/storage/prisma`.
 *
 * The adapter never imports `@prisma/client` — pass any value structurally
 * compatible with {@link PrismaProcessStoreClient}. A generated `PrismaClient`
 * automatically satisfies that shape after running
 * `npx effect-pm add prisma` followed by `prisma generate`.
 *
 * @module ProcessStore/Prisma
 */

import {
  layer,
  layerFromContext,
  make,
  PrismaClientService,
  prismaClientLayer,
} from "./PrismaProcessStore";
import { prismaSchema, prismaSchemaModelMarker } from "./schema";

export type {
  EffectPmEventDelegate,
  EffectPmEventCreateInput,
  EffectPmEventRow,
  JsonValue,
  PrismaProcessStoreClient,
} from "./types";

export { PrismaProcessStoreDecodeError } from "./codec";
export { decodeEventRow, encodeEvent } from "./codec";

/**
 * Public surface of the Prisma adapter.
 *
 * @public
 */
export const PrismaProcessStore = {
  /** Build the {@link ProcessStoreInterface} directly. */
  make,
  /** Build a `Layer` providing {@link ProcessStore} from a client instance. */
  layer,
  /**
   * Build a `Layer` providing {@link ProcessStore} from a
   * {@link PrismaClientService} in the Effect environment.
   */
  layerFromContext,
  /** Effect Context tag for the structural Prisma client. */
  PrismaClientService,
  /** Build a `Layer` providing {@link PrismaClientService} from a client. */
  prismaClientLayer,
  /** Canonical Prisma schema fragment (single `EffectPmEvent` table). */
  schema: prismaSchema,
  /** Substring used to detect existing effect-pm models. */
  schemaModelMarker: prismaSchemaModelMarker,
} as const;
