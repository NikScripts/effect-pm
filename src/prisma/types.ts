/**
 * Structural types for the Prisma-backed {@link ProcessStore}.
 *
 * @remarks
 * The adapter intentionally never imports `@prisma/client`. We declare a
 * minimal structural interface ({@link PrismaProcessStoreClient}) that any
 * generated `PrismaClient` automatically satisfies once the user has run
 * `npx effect-pm add prisma` and `prisma generate`.
 *
 * Benefits:
 * - `@prisma/client` stays an *optional* peer dependency,
 * - users can substitute an in-memory or test double without subclassing,
 * - the adapter is decoupled from any specific generator output version.
 *
 * @module ProcessStore/Prisma/Types
 */

import type {
  EffectPmEventCreateInput,
  EffectPmEventRow,
} from "../ProcessStoreEvent";

export type {
  EffectPmEventCreateInput,
  EffectPmEventRow,
  JsonValue,
} from "../ProcessStoreEvent";

// ============================================================================
// Query criteria
// ============================================================================

/**
 * Order direction for `findMany` queries.
 *
 * @internal
 */
export type SortOrder = "asc" | "desc";

/**
 * Subset of Prisma's `where` filter for `EffectPmEvent` we use.
 *
 * @internal
 */
export interface EffectPmEventWhereInput {
  type?: string | { equals?: string; in?: ReadonlyArray<string> };
  entityType?: string | { equals?: string };
  entityId?: string | { equals?: string };
  occurredAt?: {
    gt?: Date;
    gte?: Date;
    lt?: Date;
    lte?: Date;
  };
}

/**
 * Subset of Prisma's `orderBy` we use.
 *
 * @internal
 */
export interface EffectPmEventOrderByInput {
  occurredAt?: SortOrder;
}

/**
 * Subset of Prisma's `findMany` arguments we use.
 *
 * @internal
 */
export interface EffectPmEventFindManyArgs {
  where?: EffectPmEventWhereInput;
  orderBy?: EffectPmEventOrderByInput | EffectPmEventOrderByInput[];
  take?: number;
  skip?: number;
}

/**
 * Subset of Prisma's `EffectPmEvent` delegate we use.
 *
 * @public
 */
export interface EffectPmEventDelegate {
  create: (args: { data: EffectPmEventCreateInput }) => Promise<EffectPmEventRow>;
  createMany: (args: {
    data: ReadonlyArray<EffectPmEventCreateInput>;
    skipDuplicates?: boolean;
  }) => Promise<{ count: number }>;
  findMany: (args?: EffectPmEventFindManyArgs) => Promise<EffectPmEventRow[]>;
}

/**
 * Structural `PrismaClient` interface required by {@link PrismaProcessStore}.
 *
 * @remarks
 * Any `PrismaClient` generated after running the effect-pm schema setup
 * satisfies this interface structurally. Test doubles only need to implement
 * the subset we actually call.
 *
 * @public
 */
export interface PrismaProcessStoreClient {
  effectPmEvent: EffectPmEventDelegate;
}
