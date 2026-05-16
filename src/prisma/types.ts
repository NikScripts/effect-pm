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

// ============================================================================
// JSON value type
// ============================================================================

/**
 * Structural JSON value compatible with `Prisma.JsonValue`.
 *
 * @remarks
 * Mirrors the shape Prisma returns for `Json` columns and accepts on writes,
 * without depending on `@prisma/client` types.
 *
 * @public
 */
export type JsonValue =
  | null
  | string
  | number
  | boolean
  | { readonly [key: string]: JsonValue }
  | ReadonlyArray<JsonValue>;

// ============================================================================
// Persisted row shape
// ============================================================================

/**
 * Row shape persisted in the `EffectPmEvent` table.
 *
 * @remarks
 * Matches the schema fragment published by `effect-pm` (see
 * {@link prismaSchema}). `attributes` and `payload` are JSON-typed; the
 * adapter narrows their contents into typed analytics events at the read
 * boundary.
 *
 * @public
 */
export interface EffectPmEventRow {
  /** Unique event id (also the primary key). */
  id: string;
  /** Discriminator, e.g. `"process.execution.completed"`. */
  type: string;
  /** When the event occurred (used for sorting and range filters). */
  occurredAt: Date;
  /** Coarse entity domain — currently `"process"` only. */
  entityType: string;
  /** Stable identifier for the entity (e.g. process name). */
  entityId: string;
  /** Free-form, structured metadata. */
  attributes: JsonValue | null;
  /** Type-specific payload; narrowed at the read boundary. */
  payload: JsonValue;
  /** Server-assigned insertion time. */
  createdAt: Date;
}

/**
 * Subset of `Prisma.EffectPmEventCreateInput` we depend on.
 *
 * @internal
 */
export interface EffectPmEventCreateInput {
  id: string;
  type: string;
  occurredAt: Date;
  entityType: string;
  entityId: string;
  attributes?: JsonValue | null;
  payload: JsonValue;
}

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
