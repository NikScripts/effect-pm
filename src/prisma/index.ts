/**
 * Public entry point for the Prisma-backed {@link ProcessStore} placeholder.
 *
 * @remarks
 * Imported via the legacy package subpath:
 *
 * ```ts
 * import { PrismaProcessStore } from "@nikscripts/effect-pm/prisma";
 * ```
 *
 * New code should prefer `@nikscripts/effect-pm/storage/prisma`.
 * The event-table adapter is intentionally unavailable until Prisma is
 * rebuilt as a {@link RuntimeStorage} adapter over normalized
 * {@link RuntimeRecord} rows.
 *
 * The placeholder still exports structural types and schema helpers for
 * the upcoming rewrite.
 *
 * @module ProcessStore/Prisma
 */

import {
  layer,
  layerFromContext,
  make,
  PrismaClientService,
  PrismaProcessStoreUnavailableError,
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

export { PrismaProcessStoreUnavailableError } from "./PrismaProcessStore";

/**
 * Public surface of the Prisma adapter.
 *
 * @public
 */
export const PrismaProcessStore = {
  /** Throws {@link PrismaProcessStoreUnavailableError}. */
  make,
  /** Fails with {@link PrismaProcessStoreUnavailableError}. */
  layer,
  /**
   * Build a `Layer` providing {@link ProcessStore} from a
   * {@link PrismaClientService} in the Effect environment.
   */
  layerFromContext,
  /** Effect Context tag for the structural Prisma client. */
  PrismaClientService,
  /** Error raised by the placeholder adapter until the RuntimeStorage rewrite lands. */
  PrismaProcessStoreUnavailableError,
  /** Build a `Layer` providing {@link PrismaClientService} from a client. */
  prismaClientLayer,
  /** Legacy Prisma schema fragment (single `EffectPmEvent` table). */
  schema: prismaSchema,
  /** Substring used to detect existing effect-pm models. */
  schemaModelMarker: prismaSchemaModelMarker,
} as const;
