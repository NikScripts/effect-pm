/**
 * Structural types for the Prisma-backed {@link RuntimeStorage} adapter.
 *
 * @remarks
 * The adapter intentionally never imports `@prisma/client`. We declare the
 * minimal structural interface a generated Prisma client must satisfy after the
 * consumer adds the effect-pm schema fragment and runs `prisma generate`.
 *
 * @module ProcessStore/Prisma/Types
 */

import type { RuntimeRecordField, RuntimeRecordOrderField } from "../Query";

export type { JsonValue } from "../ProcessStoreEvent";

/**
 * Order direction accepted by Prisma `orderBy`.
 *
 * @internal
 */
export type SortOrder = "asc" | "desc";

/**
 * Row shape produced by the generated `EffectPmRuntimeRecord` Prisma model.
 *
 * @remarks
 * `*Json` fields are JSON text, not Prisma `Json?` columns. Keeping them as
 * strings avoids generated Prisma null sentinels in this structural interface.
 *
 * @public
 */
export interface EffectPmRuntimeRecordRow {
  readonly id: string;
  readonly type: string;
  readonly occurredAt: Date;
  readonly createdAt: Date;
  readonly runId: string;
  readonly processType: string;
  readonly processId: string;
  readonly subjectType: string | null;
  readonly subjectId: string | null;
  readonly key: string | null;
  readonly indexA: string | null;
  readonly indexB: string | null;
  readonly indexC: string | null;
  readonly indexD: string | null;
  readonly indexE: string | null;
  readonly indexF: string | null;
  readonly indexG: string | null;
  readonly indexH: string | null;
  readonly indexNamesJson: string | null;
  readonly payloadJson: string | null;
  readonly attributesJson: string | null;
  readonly readonly: boolean | null;
}

/**
 * Create input for the generated `EffectPmRuntimeRecord` model.
 *
 * @public
 */
export interface EffectPmRuntimeRecordCreateInput {
  id: string;
  type: string;
  occurredAt: Date;
  createdAt: Date;
  runId: string;
  processType: string;
  processId: string;
  subjectType?: string | null;
  subjectId?: string | null;
  key?: string | null;
  indexA?: string | null;
  indexB?: string | null;
  indexC?: string | null;
  indexD?: string | null;
  indexE?: string | null;
  indexF?: string | null;
  indexG?: string | null;
  indexH?: string | null;
  indexNamesJson?: string | null;
  payloadJson?: string | null;
  attributesJson?: string | null;
  readonly?: boolean | null;
}

/**
 * Update input used when replacing a mutable runtime row by id.
 *
 * @public
 */
export interface EffectPmRuntimeRecordUpdateInput {
  type?: string;
  occurredAt?: Date;
  createdAt?: Date;
  runId?: string;
  processType?: string;
  processId?: string;
  subjectType?: string | null;
  subjectId?: string | null;
  key?: string | null;
  indexA?: string | null;
  indexB?: string | null;
  indexC?: string | null;
  indexD?: string | null;
  indexE?: string | null;
  indexF?: string | null;
  indexG?: string | null;
  indexH?: string | null;
  indexNamesJson?: string | null;
  payloadJson?: string | null;
  attributesJson?: string | null;
  readonly?: boolean | null;
}

export type EffectPmRuntimeRecordStringField = Exclude<
  RuntimeRecordField,
  "readonly"
>;

export interface EffectPmRuntimeRecordStringFilter {
  equals?: string;
  not?: string;
  in?: Array<string>;
}

export interface EffectPmRuntimeRecordNullableStringFilter {
  equals?: string | null;
  not?: string | null;
  in?: Array<string>;
}

export interface EffectPmRuntimeRecordBooleanFilter {
  equals?: boolean | null;
  not?: boolean | null;
  in?: Array<boolean>;
}

export interface EffectPmRuntimeRecordDateTimeFilter {
  gt?: Date;
  lt?: Date;
}

export type EffectPmRuntimeRecordWhereField =
  | string
  | boolean
  | null
  | EffectPmRuntimeRecordStringFilter
  | EffectPmRuntimeRecordBooleanFilter
  | EffectPmRuntimeRecordDateTimeFilter;

export type EffectPmRuntimeRecordStringWhere =
  | string
  | EffectPmRuntimeRecordStringFilter;

export type EffectPmRuntimeRecordNullableStringWhere =
  | string
  | null
  | EffectPmRuntimeRecordNullableStringFilter;

export type EffectPmRuntimeRecordBooleanWhere =
  | boolean
  | null
  | EffectPmRuntimeRecordBooleanFilter;

/**
 * Structural subset of Prisma's generated `where` input.
 *
 * @remarks
 * This mirrors only the scalar predicates emitted by `RuntimeRecordQuery`.
 * Avoid adding JSON filters here; facet-owned payload queries should decode
 * rows and post-filter in the facet layer.
 *
 * @public
 */
export interface EffectPmRuntimeRecordWhereInput {
  id?: EffectPmRuntimeRecordStringWhere;
  type?: EffectPmRuntimeRecordStringWhere;
  runId?: EffectPmRuntimeRecordStringWhere;
  processType?: EffectPmRuntimeRecordStringWhere;
  processId?: EffectPmRuntimeRecordStringWhere;
  subjectType?: EffectPmRuntimeRecordNullableStringWhere;
  subjectId?: EffectPmRuntimeRecordNullableStringWhere;
  key?: EffectPmRuntimeRecordNullableStringWhere;
  indexA?: EffectPmRuntimeRecordNullableStringWhere;
  indexB?: EffectPmRuntimeRecordNullableStringWhere;
  indexC?: EffectPmRuntimeRecordNullableStringWhere;
  indexD?: EffectPmRuntimeRecordNullableStringWhere;
  indexE?: EffectPmRuntimeRecordNullableStringWhere;
  indexF?: EffectPmRuntimeRecordNullableStringWhere;
  indexG?: EffectPmRuntimeRecordNullableStringWhere;
  indexH?: EffectPmRuntimeRecordNullableStringWhere;
  readonly?: EffectPmRuntimeRecordBooleanWhere;
  occurredAt?: EffectPmRuntimeRecordDateTimeFilter;
  createdAt?: EffectPmRuntimeRecordDateTimeFilter;
  AND?: Array<EffectPmRuntimeRecordWhereInput> | EffectPmRuntimeRecordWhereInput;
  OR?: Array<EffectPmRuntimeRecordWhereInput>;
}

/**
 * Structural subset of Prisma's generated `orderBy` input.
 *
 * @public
 */
export type EffectPmRuntimeRecordOrderByInput = Partial<
  Record<RuntimeRecordOrderField, SortOrder>
>;

/**
 * Structural subset of Prisma's generated `findMany` arguments.
 *
 * @public
 */
export interface EffectPmRuntimeRecordFindManyArgs {
  where?: EffectPmRuntimeRecordWhereInput;
  orderBy?:
    | EffectPmRuntimeRecordOrderByInput
    | Array<EffectPmRuntimeRecordOrderByInput>;
  take?: number;
  skip?: number;
}

/**
 * Structural subset of Prisma's generated aggregate write result.
 *
 * @public
 */
export interface EffectPmRuntimeRecordBatchPayload {
  readonly count: number;
}

/**
 * Structural subset of Prisma's generated `count` arguments.
 *
 * @public
 */
export interface EffectPmRuntimeRecordCountArgs {
  where?: EffectPmRuntimeRecordWhereInput;
}

/**
 * Structural subset of Prisma's generated `updateMany` arguments.
 *
 * @public
 */
export interface EffectPmRuntimeRecordUpdateManyArgs {
  where?: EffectPmRuntimeRecordWhereInput;
  data: EffectPmRuntimeRecordUpdateInput;
}

/**
 * Structural subset of Prisma's generated `deleteMany` arguments.
 *
 * @public
 */
export interface EffectPmRuntimeRecordDeleteManyArgs {
  where?: EffectPmRuntimeRecordWhereInput;
}

/**
 * Structural subset of Prisma's generated unique selector.
 *
 * @public
 */
export interface EffectPmRuntimeRecordWhereUniqueInput {
  id: string;
}

/**
 * Subset of the generated `EffectPmRuntimeRecord` delegate used by the adapter.
 *
 * @remarks
 * The method set is intentionally narrow but real generated clients type-check
 * against it in `test/prisma-runtime-storage.generated-client.test.ts`.
 *
 * @public
 */
export interface EffectPmRuntimeRecordDelegate {
  readonly create: (args: {
    readonly data: EffectPmRuntimeRecordCreateInput;
  }) => Promise<EffectPmRuntimeRecordRow>;
  readonly findMany: (
    args?: EffectPmRuntimeRecordFindManyArgs,
  ) => Promise<Array<EffectPmRuntimeRecordRow>>;
  readonly count: (
    args?: EffectPmRuntimeRecordCountArgs,
  ) => Promise<number>;
  readonly upsert: (args: {
    readonly where: EffectPmRuntimeRecordWhereUniqueInput;
    readonly create: EffectPmRuntimeRecordCreateInput;
    readonly update: EffectPmRuntimeRecordUpdateInput;
  }) => Promise<EffectPmRuntimeRecordRow>;
  readonly update: (args: {
    readonly where: EffectPmRuntimeRecordWhereUniqueInput;
    readonly data: EffectPmRuntimeRecordUpdateInput;
  }) => Promise<EffectPmRuntimeRecordRow>;
  readonly delete: (args: {
    readonly where: EffectPmRuntimeRecordWhereUniqueInput;
  }) => Promise<EffectPmRuntimeRecordRow>;
  readonly updateMany: (
    args: EffectPmRuntimeRecordUpdateManyArgs,
  ) => Promise<EffectPmRuntimeRecordBatchPayload>;
  readonly deleteMany: (
    args?: EffectPmRuntimeRecordDeleteManyArgs,
  ) => Promise<EffectPmRuntimeRecordBatchPayload>;
}

/**
 * Structural Prisma client required by {@link PrismaRuntimeStorage}.
 *
 * @remarks
 * Includes a minimal `$transaction` callback shape for
 * {@link RuntimeStorageService.transaction}.
 *
 * @public
 */
export interface PrismaRuntimeStorageClient {
  readonly effectPmRuntimeRecord: EffectPmRuntimeRecordDelegate;
  readonly $transaction: <R>(
    fn: (client: PrismaRuntimeStorageClient) => Promise<R>,
  ) => Promise<R>;
}
