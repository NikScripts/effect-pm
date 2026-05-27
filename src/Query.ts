/**
 * Query DSL for runtime records.
 *
 * @module Query
 */

import { DateTime, Effect } from "effect";
import type {
  DeleteResult,
  RuntimeRecord,
  UpdateResult,
} from "./RuntimeStorage";
import type { JsonValue } from "./ProcessStoreEvent";

/** @public */
export interface RuntimeRecordReadable {
  readonly read?: (query?: RuntimeRecordQuery) => Effect.Effect<RuntimeRecord[], unknown, never>;
  readonly records?: (query?: RuntimeRecordQuery) => Effect.Effect<RuntimeRecord[], unknown, never>;
}

interface RuntimeRecordWritable {
  readonly create: (record: RuntimeRecord) => Effect.Effect<void, unknown, never>;
  readonly upsert: (record: RuntimeRecord) => Effect.Effect<void, unknown, never>;
  readonly update: (
    query: RuntimeRecordQuery,
    patch: RuntimeRecordPatch,
  ) => Effect.Effect<UpdateResult, unknown, never>;
  readonly delete: (query: RuntimeRecordQuery) => Effect.Effect<DeleteResult, unknown, never>;
}

/** @public */
export type RuntimeRecordField =
  | "id"
  | "type"
  | "runId"
  | "processType"
  | "processId"
  | "subjectType"
  | "subjectId"
  | "key"
  | "indexA"
  | "indexB"
  | "indexC"
  | "indexD"
  | "indexE"
  | "indexF"
  | "indexG"
  | "indexH"
  | "readonly";

/** @public */
export type RuntimeRecordOrderField =
  | "occurredAt"
  | "createdAt"
  | "runId"
  | RuntimeRecordField;

/** @public */
export type RuntimeRecordComparison =
  | {
      readonly _tag: "Equals";
      readonly field: RuntimeRecordField;
      readonly value: string | boolean;
    }
  | {
      readonly _tag: "NotEquals";
      readonly field: RuntimeRecordField;
      readonly value: string | boolean;
    }
  | {
      readonly _tag: "In";
      readonly field: RuntimeRecordField;
      readonly values: ReadonlyArray<string | boolean>;
    }
  | {
      readonly _tag: "IsNull";
      readonly field: RuntimeRecordField;
    }
  | {
      readonly _tag: "IsNotNull";
      readonly field: RuntimeRecordField;
    }
  | {
      readonly _tag: "After";
      readonly field: "occurredAt" | "createdAt";
      readonly value: DateTime.Utc;
    }
  | {
      readonly _tag: "Before";
      readonly field: "occurredAt" | "createdAt";
      readonly value: DateTime.Utc;
    }
  | {
      readonly _tag: "Between";
      readonly field: "occurredAt" | "createdAt";
      readonly start: DateTime.Utc;
      readonly end: DateTime.Utc;
    };

/** @public */
export type RuntimeRecordPredicate =
  | RuntimeRecordComparison
  | {
      readonly _tag: "And";
      readonly predicates: ReadonlyArray<RuntimeRecordPredicate>;
    }
  | {
      readonly _tag: "Or";
      readonly predicates: ReadonlyArray<RuntimeRecordPredicate>;
    };

/** @public */
export interface RuntimeRecordOrderBy {
  readonly field: RuntimeRecordOrderField;
  readonly direction: "asc" | "desc";
}

/** @public */
export interface RuntimeRecordQuery {
  readonly predicate?: RuntimeRecordPredicate;
  readonly orderBy?: ReadonlyArray<RuntimeRecordOrderBy>;
  readonly limit?: number;
  readonly offset?: number;
}

/** @public */
export type RuntimeRecordPatch = Partial<{
  readonly type: string;
  readonly occurredAt: DateTime.Utc;
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
  readonly indexNames: ReadonlyArray<string> | null;
  readonly payload: JsonValue | null;
  readonly attributes: JsonValue | null;
}>;

/** @public */
export interface RuntimeRecordAssignment {
  readonly field: keyof RuntimeRecordPatch;
  readonly value: RuntimeRecordPatch[keyof RuntimeRecordPatch];
}

export interface RuntimeRecordQueryTarget<Source extends Effect.Effect<any, any, any>> {
  readonly _tag: "RuntimeRecordQueryTarget";
  readonly source: Source;
  readonly query: RuntimeRecordQuery;
}

const emptyQuery: RuntimeRecordQuery = {};

const combine = (
  left: RuntimeRecordPredicate | undefined,
  right: RuntimeRecordPredicate,
): RuntimeRecordPredicate =>
  left === undefined
    ? right
    : { _tag: "And", predicates: [left, right] };

const makeComparisonColumn = (field: RuntimeRecordField) => ({
  equals: (value: string | boolean): RuntimeRecordPredicate => ({
    _tag: "Equals",
    field,
    value,
  }),
  notEquals: (value: string | boolean): RuntimeRecordPredicate => ({
    _tag: "NotEquals",
    field,
    value,
  }),
  in: (values: ReadonlyArray<string | boolean>): RuntimeRecordPredicate => ({
    _tag: "In",
    field,
    values,
  }),
  isNull: { _tag: "IsNull", field } satisfies RuntimeRecordPredicate,
  isNotNull: { _tag: "IsNotNull", field } satisfies RuntimeRecordPredicate,
});

const makeStringAssignmentColumn = <Field extends keyof RuntimeRecordPatch>(
  field: Field,
) => ({
  set: (value: Exclude<RuntimeRecordPatch[Field], null | undefined>): RuntimeRecordAssignment => ({
    field,
    value,
  }),
  unset: { field, value: null } satisfies RuntimeRecordAssignment,
});

const makeJsonAssignmentColumn = <Field extends "payload" | "attributes">(
  field: Field,
) => ({
  set: (value: JsonValue): RuntimeRecordAssignment => ({
    field,
    value,
  }),
  unset: { field, value: null } satisfies RuntimeRecordAssignment,
});

const makeDateColumn = (field: "occurredAt" | "createdAt") => ({
  after: (value: DateTime.Utc): RuntimeRecordPredicate => ({
    _tag: "After",
    field,
    value,
  }),
  before: (value: DateTime.Utc): RuntimeRecordPredicate => ({
    _tag: "Before",
    field,
    value,
  }),
  between: (
    start: DateTime.Utc,
    end: DateTime.Utc,
  ): RuntimeRecordPredicate => ({
    _tag: "Between",
    field,
    start,
    end,
  }),
});

const isQueryTarget = (
  value: unknown,
): value is RuntimeRecordQueryTarget<Effect.Effect<unknown, unknown, unknown>> =>
  typeof value === "object" &&
  value !== null &&
  "_tag" in value &&
  value._tag === "RuntimeRecordQueryTarget";

const isRuntimeRecordReadable = (value: unknown): value is RuntimeRecordReadable =>
  typeof value === "object" &&
  value !== null &&
  (("read" in value && typeof value.read === "function") ||
    ("records" in value && typeof value.records === "function"));

const isRuntimeRecordWritable = (value: unknown): value is RuntimeRecordWritable =>
  typeof value === "object" &&
  value !== null &&
  "create" in value &&
  typeof value.create === "function" &&
  "upsert" in value &&
  typeof value.upsert === "function" &&
  "update" in value &&
  typeof value.update === "function" &&
  "delete" in value &&
  typeof value.delete === "function";

const withOrder = <Source extends Effect.Effect<any, any, any>>(
  target: RuntimeRecordQueryTarget<Source>,
  orderBy: RuntimeRecordOrderBy,
): RuntimeRecordQueryTarget<Source> => ({
  ...target,
  query: {
    ...target.query,
    orderBy: [...(target.query.orderBy ?? []), orderBy],
  },
});

interface PipeableOrderBy {
  (direction?: "asc" | "desc"): <Source extends Effect.Effect<any, any, any>>(
    target: RuntimeRecordQueryTarget<Source>,
  ) => RuntimeRecordQueryTarget<Source>;
  <Source extends Effect.Effect<any, any, any>>(
    target: RuntimeRecordQueryTarget<Source>,
  ): RuntimeRecordQueryTarget<Source>;
}

const makeOrderBy = (field: RuntimeRecordOrderField): PipeableOrderBy => {
  function orderBy<Source extends Effect.Effect<any, any, any>>(
    target: RuntimeRecordQueryTarget<Source>,
  ): RuntimeRecordQueryTarget<Source>;
  function orderBy(direction?: "asc" | "desc"): <Source extends Effect.Effect<any, any, any>>(
    target: RuntimeRecordQueryTarget<Source>,
  ) => RuntimeRecordQueryTarget<Source>;
  function orderBy(
    arg?: "asc" | "desc" | RuntimeRecordQueryTarget<Effect.Effect<unknown, unknown, unknown>>,
  ):
    | RuntimeRecordQueryTarget<Effect.Effect<unknown, unknown, unknown>>
    | (<Source extends Effect.Effect<any, any, any>>(
        target: RuntimeRecordQueryTarget<Source>,
      ) => RuntimeRecordQueryTarget<Source>) {
    if (isQueryTarget(arg)) {
      return withOrder(arg, { field, direction: "desc" });
    }
    const direction = arg ?? "desc";
    return <Source extends Effect.Effect<any, any, any>>(target: RuntimeRecordQueryTarget<Source>) =>
      withOrder(target, { field, direction });
  }
  return orderBy;
};

/** @public */
export const Id = makeComparisonColumn("id");
/** @public */
export const Type = makeComparisonColumn("type");
/** @public */
export const RunId = makeComparisonColumn("runId");
/** @public */
export const ProcessType = makeComparisonColumn("processType");
/** @public */
export const ProcessId = makeComparisonColumn("processId");
/** @public */
export const SubjectType = makeComparisonColumn("subjectType");
/** @public */
export const SubjectId = makeComparisonColumn("subjectId");
/** @public */
export const Key = makeComparisonColumn("key");
/** @public */
export const IndexA = {
  ...makeComparisonColumn("indexA"),
  ...makeStringAssignmentColumn("indexA"),
};
/** @public */
export const IndexB = {
  ...makeComparisonColumn("indexB"),
  ...makeStringAssignmentColumn("indexB"),
};
/** @public */
export const IndexC = {
  ...makeComparisonColumn("indexC"),
  ...makeStringAssignmentColumn("indexC"),
};
/** @public */
export const IndexD = {
  ...makeComparisonColumn("indexD"),
  ...makeStringAssignmentColumn("indexD"),
};
/** @public */
export const IndexE = {
  ...makeComparisonColumn("indexE"),
  ...makeStringAssignmentColumn("indexE"),
};
/** @public */
export const IndexF = {
  ...makeComparisonColumn("indexF"),
  ...makeStringAssignmentColumn("indexF"),
};
/** @public */
export const IndexG = {
  ...makeComparisonColumn("indexG"),
  ...makeStringAssignmentColumn("indexG"),
};
/** @public */
export const IndexH = {
  ...makeComparisonColumn("indexH"),
  ...makeStringAssignmentColumn("indexH"),
};
/** @public */
export const Readonly = makeComparisonColumn("readonly");
/** @public */
export const Occurred = makeDateColumn("occurredAt");
/** @public */
export const Created = makeDateColumn("createdAt");
/** @public */
export const Payload = makeJsonAssignmentColumn("payload");
/** @public */
export const Attributes = makeJsonAssignmentColumn("attributes");

/**
 * Combine predicates with logical AND.
 *
 * @remarks
 * Empty groups intentionally match no rows. Use `Where()` with no arguments
 * when you want an unfiltered query.
 *
 * @public
 */
export const And = (
  predicates: ReadonlyArray<RuntimeRecordPredicate>,
): RuntimeRecordPredicate => ({ _tag: "And", predicates });

/**
 * Combine predicates with logical OR. Empty groups match no rows.
 *
 * @public
 */
export const Or = (
  predicates: ReadonlyArray<RuntimeRecordPredicate>,
): RuntimeRecordPredicate => ({ _tag: "Or", predicates });

/** @public */
export const Where = (
  ...predicates: ReadonlyArray<RuntimeRecordPredicate>
) =>
<Source extends Effect.Effect<RuntimeRecordReadable, any, any>>(
  source: Source,
): RuntimeRecordQueryTarget<Source> => ({
  _tag: "RuntimeRecordQueryTarget",
  source,
  query: {
    ...emptyQuery,
    predicate: predicates.reduce<RuntimeRecordPredicate | undefined>(
      combine,
      undefined,
    ),
  },
});

/** @public */
export const Limit = (limit: number) =>
<Source extends Effect.Effect<any, any, any>>(
  target: RuntimeRecordQueryTarget<Source>,
): RuntimeRecordQueryTarget<Source> => ({
  ...target,
  query: { ...target.query, limit },
});

/** @public */
export const Offset = (offset: number) =>
<Source extends Effect.Effect<any, any, any>>(
  target: RuntimeRecordQueryTarget<Source>,
): RuntimeRecordQueryTarget<Source> => ({
  ...target,
  query: { ...target.query, offset },
});

/** @public */
export const OrderBy = {
  occurredAt: makeOrderBy("occurredAt"),
  createdAt: makeOrderBy("createdAt"),
  runId: makeOrderBy("runId"),
} as const;

/** @public */
export const Select = <Source extends Effect.Effect<any, any, any>>(
  target: RuntimeRecordQueryTarget<Source>,
): Effect.Effect<RuntimeRecord[], Effect.Error<Source> | unknown, Effect.Services<Source>> =>
  Effect.flatMap(target.source, (storage) => {
    if (!isRuntimeRecordReadable(storage)) {
      return Effect.die("Runtime record source does not support read or records");
    }
    if (storage.read !== undefined) {
      return storage.read(target.query);
    }
    return storage.records?.(target.query) ??
      Effect.die("Runtime record source does not support records");
  });

const patchFromAssignments = (
  assignments: ReadonlyArray<RuntimeRecordAssignment>,
): RuntimeRecordPatch => {
  const patch: Record<string, RuntimeRecordPatch[keyof RuntimeRecordPatch]> = {};
  for (const assignment of assignments) {
    patch[assignment.field] = assignment.value;
  }
  return patch;
};

/** @public */
export function Update(patch: RuntimeRecordPatch): <E, R>(
  target: RuntimeRecordQueryTarget<Effect.Effect<RuntimeRecordWritable, E, R>>,
) => Effect.Effect<UpdateResult, E | unknown, R>;
export function Update(...assignments: ReadonlyArray<RuntimeRecordAssignment>): <E, R>(
  target: RuntimeRecordQueryTarget<Effect.Effect<RuntimeRecordWritable, E, R>>,
) => Effect.Effect<UpdateResult, E | unknown, R>;
export function Update(
  first: RuntimeRecordPatch | RuntimeRecordAssignment,
  ...rest: ReadonlyArray<RuntimeRecordAssignment>
) {
  const patch = "field" in first
    ? patchFromAssignments([first, ...rest])
    : first;
  return <E, R>(target: RuntimeRecordQueryTarget<Effect.Effect<RuntimeRecordWritable, E, R>>) =>
    Effect.flatMap(target.source, (storage) =>
      isRuntimeRecordWritable(storage)
        ? storage.update(target.query, patch)
        : Effect.die("Runtime record source does not support update")
    );
}

/** @public */
export const Delete = <E, R>(
  target: RuntimeRecordQueryTarget<Effect.Effect<RuntimeRecordWritable, E, R>>,
): Effect.Effect<DeleteResult, E | unknown, R> =>
  Effect.flatMap(target.source, (storage) =>
    isRuntimeRecordWritable(storage)
      ? storage.delete(target.query)
      : Effect.die("Runtime record source does not support delete")
  );

/** @public */
export const Insert = (
  record: RuntimeRecord,
) =>
<Source extends Effect.Effect<RuntimeRecordWritable, any, any>>(
  source: Source,
): Effect.Effect<void, Effect.Error<Source> | unknown, Effect.Services<Source>> =>
  Effect.flatMap(source, (storage) =>
    isRuntimeRecordWritable(storage)
      ? storage.create(record)
      : Effect.die("Runtime record source does not support create")
  );

/** @public */
export const Upsert = (
  record: RuntimeRecord,
) =>
<Source extends Effect.Effect<RuntimeRecordWritable, any, any>>(
  source: Source,
): Effect.Effect<void, Effect.Error<Source> | unknown, Effect.Services<Source>> =>
  Effect.flatMap(source, (storage) =>
    isRuntimeRecordWritable(storage)
      ? storage.upsert(record)
      : Effect.die("Runtime record source does not support upsert")
  );

/**
 * Runtime record query DSL — columns, combinators, and storage operations.
 *
 * @remarks
 * Root imports (`And`, `Id`, `Select`, …) are the same bindings as
 * {@link Query.And}, {@link Query.Id}, {@link Query.Select}, etc.
 *
 * @public
 */
export const Query = {
  And,
  Attributes,
  Created,
  Delete,
  Id,
  IndexA,
  IndexB,
  IndexC,
  IndexD,
  IndexE,
  IndexF,
  IndexG,
  IndexH,
  Insert,
  Key,
  Limit,
  Occurred,
  Offset,
  Or,
  OrderBy,
  Payload,
  ProcessId,
  ProcessType,
  Readonly,
  RunId,
  Select,
  SubjectId,
  SubjectType,
  Type,
  Update,
  Upsert,
  Where,
} as const;

