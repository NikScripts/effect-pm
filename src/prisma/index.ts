/**
 * Public entry point for the Prisma-backed {@link RuntimeStorage} adapter.
 *
 * @remarks
 * Import directly or through the storage subpath:
 *
 * ```ts
 * import { PrismaRuntimeStorage } from "@nikscripts/effect-pm/storage/prisma";
 * ```
 *
 * The adapter stores normalized {@link RuntimeRecord} rows through the
 * consumer's generated Prisma client.
 *
 * @module PrismaRuntimeStorage
 */

import {
  layer,
  layerFromContext,
  layerProcessStore,
  make,
  PrismaClientService,
  prismaClientLayer,
} from "./PrismaRuntimeStorage";
import { prismaSchema, prismaSchemaModelMarker } from "./schema";

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
} from "./types";

/**
 * Public surface of the Prisma adapter.
 *
 * @public
 */
export const PrismaRuntimeStorage = {
  /** Construct a Prisma-backed RuntimeStorage service. */
  make,
  /** Build a Layer providing RuntimeStorage from an injected Prisma client. */
  layer,
  /**
   * Build a `Layer` providing RuntimeStorage from a
   * {@link PrismaClientService} in the Effect environment.
   */
  layerFromContext,
  /** Build all built-in ProcessStore facets from an injected Prisma client. */
  layerProcessStore,
  /** Effect Context tag for the structural Prisma client. */
  PrismaClientService,
  /** Build a `Layer` providing {@link PrismaClientService} from a client. */
  prismaClientLayer,
  /** Prisma schema fragment for normalized RuntimeRecord rows. */
  schema: prismaSchema,
  /** Substring used to detect existing effect-pm models. */
  schemaModelMarker: prismaSchemaModelMarker,
} satisfies {
  readonly make: typeof make;
  readonly layer: typeof layer;
  readonly layerFromContext: typeof layerFromContext;
  readonly layerProcessStore: typeof layerProcessStore;
  readonly PrismaClientService: typeof PrismaClientService;
  readonly prismaClientLayer: typeof prismaClientLayer;
  readonly schema: typeof prismaSchema;
  readonly schemaModelMarker: typeof prismaSchemaModelMarker;
};
