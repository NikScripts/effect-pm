/**
 * Shape-first {@link Store.contract} definitions — compile, extend, materialize handles.
 *
 * @module internal/store/contractDef
 * @internal
 */

import { Effect, Pipeable, Schema } from "effect";
import type { Simplify } from "effect/Types";
import { storeAppend, storeQuery } from "./builders";
import { StoreShapeNotMaterialized } from "./errors";
import type { StoreWriteError } from "./errors";
import { makeScopeHandle } from "./memoryScope";
import type { AppendSideEffects } from "./memoryScope";
import type { StoreSpec } from "./spec";
import {
  storeReadPayloadSchema,
  type StoreReadPayload,
} from "./where";

export const storeContractSym = Symbol.for("hyperlink-ts/Store/contractDef");
export const storeShapeSym = Symbol.for("hyperlink-ts/Store/shape");
export const shapeRefSym = Symbol.for("hyperlink-ts/Store/shapeRef");

/** @deprecated Empty read payload — reads now use {@link storeReadPayloadSchema}. @internal */
export const emptyPayloadSchema = Schema.Struct({});
/** @deprecated @internal */
export type EmptyReadPayload = typeof emptyPayloadSchema.Type;

/** Row shape definition — system read payload is baked in (not per-shape). @internal */
export interface StoreShapeDef<Row extends Schema.Schema<unknown> = Schema.Schema<unknown>> {
  readonly [storeShapeSym]: typeof storeShapeSym;
  readonly row: Row;
}

/** A leaf shape value — row schema or {@link StoreShapeDef}. @internal */
export type StoreShapeInputLeaf = Schema.Schema<unknown> | StoreShapeDef;

/** A nested sub-tree of shape inputs — the recursive case. Must be an `interface`, not a `type` alias:
 *  {@link StoreShapeInput} unions back to it, and a `type` alias fails with TS2456 (`circularly
 *  references itself`) while an interface breaks the cycle. @internal */
export interface StoreShapeTree extends Readonly<Record<string, StoreShapeInput>> {}

/** Part 1 shape value — a leaf (row schema or {@link StoreShapeDef}) or a nested sub-tree. @internal */
export type StoreShapeInput = StoreShapeInputLeaf | StoreShapeTree;

/** @internal */
export type NormalizedShape = {
  readonly row: Schema.Schema<unknown>;
  /** Always the baked-in system read payload schema. */
  readonly read: typeof storeReadPayloadSchema;
};

/** @internal */
export type StoreShapes = Readonly<Record<string, StoreShapeInput>>;

/**
 * Type of the top-level normalized map. Kept flat and non-recursive (byte-identical to the previous
 * definition) so the resolved-handle types in `spec.ts` are unchanged for flat contracts. The
 * runtime `normalized` value is flattened to dotted leaf keys by {@link collectNormalizedInto}; the
 * nested API surface (selection, per-shape rows) is typed structurally by {@link ShapeRefs} /
 * {@link AllShapeRows}, not by this map. @internal
 */
export type NormalizedShapes<Shapes extends StoreShapes> = {
  readonly [K in keyof Shapes & string]: NormalizeShape<Shapes[K]>;
};

/** @internal */
export type NormalizeShape<S extends StoreShapeInput> = S extends StoreShapeDef<infer Row>
  ? { readonly row: Row; readonly read: typeof storeReadPayloadSchema }
  : S extends Schema.Schema<infer _A>
    ? { readonly row: S; readonly read: typeof storeReadPayloadSchema }
    : never;

export const CUSTOM_READ_ALIAS = "Store/customReadAlias" as const;
export const CUSTOM_APPEND_ALIAS = "Store/customAppendAlias" as const;
export const CUSTOM_EFFECT = "Store/customEffect" as const;
export const CUSTOM_FN = "Store/customFn" as const;

type ErasedChannel = NonNullable<unknown>;

/** Compiled custom method entry. @internal */
export type CustomMethodEntry =
  | { readonly _tag: typeof CUSTOM_READ_ALIAS; readonly shapeKey: string }
  | { readonly _tag: typeof CUSTOM_APPEND_ALIAS; readonly shapeKey: string }
  | { readonly _tag: typeof CUSTOM_EFFECT; readonly effect: Effect.Effect<unknown, ErasedChannel, ErasedChannel> }
  | {
      readonly _tag: typeof CUSTOM_FN;
      readonly fn: (payload: unknown) => Effect.Effect<unknown, ErasedChannel, ErasedChannel>;
    };

/** @internal */
export interface ShapeBinding {
  readonly shapeKey: string;
  append: ((input: unknown) => Effect.Effect<void>) | undefined;
  read: ((payload?: unknown) => Effect.Effect<unknown>) | undefined;
}

/** Decoded {@link Schema.Schema.Type} with a flattened object shape. @internal */
export type SchemaDecoded<S extends Schema.Schema<unknown>> = S extends Schema.Struct<
  infer F extends Schema.Struct.Fields
>
  ? Simplify<Schema.Struct.Type<F>>
  : Simplify<Schema.Schema.Type<S>>;

/** Inlined append/read members — expanded for readable hovers (not alias names). @internal */
export type ShapeNamespaceMembers<Row extends Schema.Schema<unknown>> = {
  readonly append: (
    row: SchemaDecoded<Row> | ReadonlyArray<SchemaDecoded<Row>>,
  ) => Effect.Effect<void, StoreWriteError>;
  readonly read: (
    payload?: StoreReadPayload<SchemaDecoded<Row>>,
  ) => Effect.Effect<ReadonlyArray<SchemaDecoded<Row>>>;
};

/** @internal */
export type ShapeReadFn<Row extends Schema.Schema<unknown>> = ShapeNamespaceMembers<Row>["read"];

/** @internal */
export type ShapeAppendFn<Row extends Schema.Schema<unknown>> =
  ShapeNamespaceMembers<Row>["append"];

/** @internal */
export type ShapeHandle<N extends NormalizedShape> = {
  readonly schema: N["row"];
  readonly readPayload: typeof storeReadPayloadSchema;
  readonly append: ShapeAppendFn<N["row"]>;
  readonly read: ShapeReadFn<N["row"]>;
};

/**
 * Drop Effect-style private fields (`_…`) from a shape / handle key map.
 *
 * @internal
 */
export type PublicShapeKey<K extends string> = K extends `_${string}` ? never : K;

/**
 * Recursive handle tree passed to a contract's methods function: a leaf shape → its
 * {@link ShapeHandle} (`{ schema, readPayload, append, read }`), a sub-tree → nested
 * {@link ShapeHandles}. So `shapes.sensors.temperature.append` navigates the tree.
 *
 * Underscore-prefixed shapes (e.g. platform `_logs`) are omitted — same privacy as Effect
 * `_`-fields.
 *
 * @internal
 */
export type ShapeHandles<Shapes extends StoreShapes> = {
  readonly [K in keyof Shapes & string as PublicShapeKey<K>]: Shapes[K] extends StoreShapeInputLeaf
    ? ShapeHandle<NormalizeShape<Shapes[K]>>
    : Shapes[K] extends StoreShapeTree
      ? ShapeHandles<Shapes[K]>
      : never;
};

/** Row schema of a leaf shape. @internal */
export type RowSchemaOf<S extends StoreShapeInputLeaf> = NormalizeShape<S>["row"];

/**
 * A selectable leaf marker carrying the shape's row schema at the type level — the value passed to a
 * {@link Store.changes} selector, e.g. `(shapes) => shapes.sensors.temperature`. @internal
 */
export interface ShapeRef<Row extends Schema.Schema<unknown>> {
  readonly [shapeRefSym]: typeof shapeRefSym;
  readonly shapeKey: string;
  readonly row: Row;
}

/** The shape tree exposed as selectable {@link ShapeRef}s — leaves are refs, sub-trees recurse. @internal */
export type ShapeRefs<Shapes extends StoreShapes> = {
  readonly [K in keyof Shapes & string as PublicShapeKey<K>]: Shapes[K] extends StoreShapeInputLeaf
    ? ShapeRef<RowSchemaOf<Shapes[K]>>
    : Shapes[K] extends StoreShapeTree
      ? ShapeRefs<Shapes[K]>
      : never;
};

/** Union of every leaf's decoded row across a (possibly nested) shape tree. @internal */
export type AllShapeRows<Shapes extends StoreShapes> = {
  [K in PublicShapeKey<keyof Shapes & string>]: Shapes[K] extends StoreShapeInputLeaf
    ? SchemaDecoded<RowSchemaOf<Shapes[K]>>
    : Shapes[K] extends StoreShapeTree
      ? AllShapeRows<Shapes[K]>
      : never;
}[PublicShapeKey<keyof Shapes & string>];

/** A store class exposing a single scope's contract — the `store` argument to {@link Store.changes}. @internal */
export interface StoreClassWithShapes<C extends StoreContractValue = StoreContractValue> {
  readonly scopeKey: string;
  readonly contract: C;
}

/** Shapes of a {@link StoreClassWithShapes}. @internal */
export type ShapesOfStore<S extends StoreClassWithShapes> = S["contract"]["shapes"];

/** @internal */
export type StoreMethodsFn<Shapes extends StoreShapes> = (
  shapes: ShapeHandles<Shapes>,
) => Readonly<Record<string, unknown>>;

/** @internal */
export type NoCustom = Readonly<Record<never, never>>;

/** @internal */
export interface StoreContractDef<
  Shapes extends StoreShapes = StoreShapes,
  Custom extends Readonly<Record<string, unknown>> = NoCustom,
> {
  readonly [storeContractSym]: typeof storeContractSym;
  readonly shapes: Shapes;
  readonly normalized: NormalizedShapes<Shapes>;
  readonly spec: StoreSpec;
  readonly custom: Custom;
  readonly customEntries: Readonly<Record<string, CustomMethodEntry>>;
  readonly shapeBindings: ReadonlyArray<ShapeBinding>;
}

/** @internal */
export type StoreContractValue<
  Shapes extends StoreShapes = StoreShapes,
  Custom extends Readonly<Record<string, unknown>> = NoCustom,
> = StoreContractDef<Shapes, Custom> & Pipeable.Pipeable;

/** Narrow a value to a concrete {@link StoreContractValue} without widening to defaults. @internal */
export type IsStoreContractValue<V> = V extends {
  readonly [storeContractSym]: typeof storeContractSym;
}
  ? V
  : never;

const readSpecKey = (shapeKey: string): string => `${shapeKey}/read`;

/** @internal */
export const isStoreShapeDef = (value: unknown): value is StoreShapeDef =>
  typeof value === "object" &&
  value !== null &&
  storeShapeSym in value &&
  value[storeShapeSym] === storeShapeSym;

/** True for a leaf shape value — a row schema or a {@link StoreShapeDef}. @internal */
export const isStoreShapeLeaf = (value: unknown): value is StoreShapeInputLeaf =>
  Schema.isSchema(value) || isStoreShapeDef(value);

/** True for a nested sub-tree of shape inputs (a plain record of shape inputs). @internal */
export const isStoreShapeTree = (value: unknown): value is StoreShapeTree =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  !isStoreShapeLeaf(value) &&
  !isStoreContractValue(value) &&
  Object.values(value).every((entry) => isStoreShapeInput(entry));

/** @internal */
export const isStoreShapeInput = (value: unknown): value is StoreShapeInput =>
  isStoreShapeLeaf(value) || isStoreShapeTree(value);

/** @internal */
export const normalizeShapeInput = (input: StoreShapeInputLeaf): NormalizedShape =>
  isStoreShapeDef(input)
    ? { row: input.row, read: storeReadPayloadSchema }
    : { row: input, read: storeReadPayloadSchema };

/** @internal */
export function makeStoreShape<Row extends Schema.Schema<unknown>>(row: Row): StoreShapeDef<Row> {
  return {
    [storeShapeSym]: storeShapeSym,
    row,
  };
}

/** @internal */
export const isStoreContractValue = (value: unknown): value is StoreContractValue =>
  typeof value === "object" &&
  value !== null &&
  storeContractSym in value;

/** @internal */
export const isStoreShapeMap = (value: unknown): value is StoreShapes =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  !isStoreContractValue(value) &&
  Object.values(value).every((entry) => isStoreShapeInput(entry));

/** @internal */
export const toStoreContract = (
  input: StoreContractValue | StoreShapes,
): StoreContractValue =>
  isStoreContractValue(input) ? input : makeStoreContractValue(input);

/** @internal */
export const contractSpec = (contract: StoreContractValue): StoreSpec => contract.spec;

const appendMany = (
  appendOne: (payload: unknown) => Effect.Effect<void>,
  input: unknown,
): Effect.Effect<void> => {
  if (Array.isArray(input)) {
    return Effect.all(input.map((row) => appendOne(row)), { discard: true });
  }
  return appendOne(input);
};

/** Join a dotted-path prefix with a key (runtime mirror of {@link ShapeKeyPath}). @internal */
const dottedKey = (prefix: string, key: string): string => (prefix === "" ? key : `${prefix}.${key}`);

/** Flatten a (possibly nested) shape tree into a dotted-keyed map of normalized leaves. @internal */
const collectNormalizedInto = (
  shapes: StoreShapes,
  prefix: string,
  out: Record<string, NormalizedShape>,
): void => {
  for (const key of Object.keys(shapes)) {
    const value = shapes[key]!;
    const dotted = dottedKey(prefix, key);
    if (isStoreShapeLeaf(value)) {
      out[dotted] = normalizeShapeInput(value);
    } else if (isStoreShapeTree(value)) {
      collectNormalizedInto(value, dotted, out);
    }
  }
};

/** Materialized handle tree plus an identity index (`append`/`read` fn → its alias entry). @internal */
interface ShapeHandlesResult<Shapes extends StoreShapes> {
  readonly handles: ShapeHandles<Shapes>;
  readonly aliasByFn: ReadonlyMap<unknown, CustomMethodEntry>;
}

const makeShapeHandles = <const Shapes extends StoreShapes>(
  shapes: Shapes,
  bindings: Array<ShapeBinding>,
): ShapeHandlesResult<Shapes> => {
  const bindingByKey = new Map(bindings.map((binding) => [binding.shapeKey, binding]));
  const aliasByFn = new Map<unknown, CustomMethodEntry>();

  const buildLeaf = (value: StoreShapeInputLeaf, dotted: string): Record<string, unknown> => {
    const normalized = normalizeShapeInput(value);
    let binding = bindingByKey.get(dotted);
    if (binding === undefined) {
      binding = { shapeKey: dotted, append: undefined, read: undefined };
      bindings.push(binding);
      bindingByKey.set(dotted, binding);
    }
    const boundTo = binding;

    const append = (input: unknown) =>
      Effect.suspend(() => {
        if (boundTo.append === undefined) {
          return Effect.die(
            new StoreShapeNotMaterialized({ shapeKey: dotted, operation: "append" }),
          );
        }
        return appendMany(boundTo.append, input);
      });

    const read = (payload?: unknown) =>
      Effect.suspend(() => {
        if (boundTo.read === undefined) {
          return Effect.die(
            new StoreShapeNotMaterialized({ shapeKey: dotted, operation: "read" }),
          );
        }
        return boundTo.read(payload ?? {});
      });

    aliasByFn.set(append, { _tag: CUSTOM_APPEND_ALIAS, shapeKey: dotted });
    aliasByFn.set(read, { _tag: CUSTOM_READ_ALIAS, shapeKey: dotted });

    return {
      schema: normalized.row,
      readPayload: normalized.read,
      append,
      read,
    };
  };

  const buildNode = (node: StoreShapes, prefix: string): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(node)) {
      const value = node[key]!;
      const dotted = dottedKey(prefix, key);
      out[key] = isStoreShapeLeaf(value) ? buildLeaf(value, dotted) : buildNode(value, dotted);
    }
    return out;
  };

  // The handle tree is assembled by dynamic property assignment, so — like the previous flat
  // implementation — the structural type is asserted once here at the generic-object rebuild.
  return { handles: buildNode(shapes, "") as ShapeHandles<Shapes>, aliasByFn };
};

/** Build the selectable {@link ShapeRefs} tree for a shape map (leaves carry dotted key + row schema). @internal */
export const makeShapeRefs = (shapes: StoreShapes): ShapeRefs<StoreShapes> => {
  const buildNode = (node: StoreShapes, prefix: string): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(node)) {
      const value = node[key]!;
      const dotted = dottedKey(prefix, key);
      out[key] = isStoreShapeLeaf(value)
        ? {
            [shapeRefSym]: shapeRefSym,
            shapeKey: dotted,
            row: normalizeShapeInput(value).row,
          }
        : buildNode(value, dotted);
    }
    return out;
  };
  // Same one-spot structural rebuild idiom as makeShapeHandles.
  return buildNode(shapes, "") as ShapeRefs<StoreShapes>;
};

/** Flat map of every leaf shape's dotted key → row schema (across the nested tree). @internal */
export const shapeRowsByKey = (
  shapes: StoreShapes,
): ReadonlyMap<string, Schema.Schema<unknown>> => {
  const out = new Map<string, Schema.Schema<unknown>>();
  const walk = (node: StoreShapes, prefix: string): void => {
    for (const key of Object.keys(node)) {
      const value = node[key]!;
      const dotted = dottedKey(prefix, key);
      if (isStoreShapeLeaf(value)) {
        out.set(dotted, normalizeShapeInput(value).row);
      } else if (isStoreShapeTree(value)) {
        walk(value, dotted);
      }
    }
  };
  walk(shapes, "");
  return out;
};

/** A resolved {@link ShapeRef} — the runtime value a {@link Store.changes} selector returns. @internal */
export interface ResolvedShapeRef {
  readonly shapeKey: string;
  readonly row: Schema.Schema<unknown>;
}

/** Read the dotted key + row schema from a value returned by a shape selector. @internal */
export const resolveShapeRef = (value: unknown): ResolvedShapeRef => {
  if (
    typeof value === "object" &&
    value !== null &&
    shapeRefSym in value &&
    "shapeKey" in value &&
    "row" in value &&
    typeof value.shapeKey === "string" &&
    Schema.isSchema(value.row)
  ) {
    return { shapeKey: value.shapeKey, row: value.row };
  }
  throw new Error("Store.changes: selector must return a shape ref, e.g. (shapes) => shapes.readings");
};

const assertDisjointCustomKeys = <Shapes extends StoreShapes>(
  shapes: Shapes,
  customKeys: ReadonlyArray<string>,
): void => {
  for (const key of customKeys) {
    if (key in shapes) {
      throw new Error(
        `Store.contract: custom method "${key}" collides with shape namespace "${key}"`,
      );
    }
  }
};

const classifyCustomMethod = (
  methodName: string,
  value: unknown,
  aliasByFn: ReadonlyMap<unknown, CustomMethodEntry>,
): CustomMethodEntry => {
  const alias = aliasByFn.get(value);
  if (alias !== undefined) {
    return alias;
  }
  if (typeof value === "object" && value !== null && Effect.TypeId in value) {
    const effectValue: unknown = value;
    return {
      _tag: CUSTOM_EFFECT,
      effect: effectValue as Effect.Effect<unknown, ErasedChannel, ErasedChannel>,
    };
  }
  if (typeof value === "function") {
    return {
      _tag: CUSTOM_FN,
      fn: value as (payload: unknown) => Effect.Effect<unknown, ErasedChannel, ErasedChannel>,
    };
  }
  throw new Error(
    `Store.contract: custom method "${methodName}" must be an Effect, an effect function, or a shape append/read alias`,
  );
};

const compileCustomMethods = <
  const Shapes extends StoreShapes,
  const Custom extends Readonly<Record<string, unknown>>,
>(
  shapes: Shapes,
  methods: (handles: ShapeHandles<Shapes>) => Custom,
  bindings: Array<ShapeBinding>,
): { readonly custom: Custom; readonly customEntries: Readonly<Record<string, CustomMethodEntry>> } => {
  const { handles, aliasByFn } = makeShapeHandles(shapes, bindings);
  const built = methods(handles);
  assertDisjointCustomKeys(shapes, Object.keys(built));
  const customEntries: Record<string, CustomMethodEntry> = {};
  for (const [methodName, value] of Object.entries(built)) {
    customEntries[methodName] = classifyCustomMethod(methodName, value, aliasByFn);
  }
  return { custom: built, customEntries };
};

const compileStoreContractBody = <
  const Shapes extends StoreShapes,
  const Custom extends Readonly<Record<string, unknown>> = NoCustom,
>(
  shapes: Shapes,
  methods?: (handles: ShapeHandles<Shapes>) => Custom,
): StoreContractDef<Shapes, Custom extends NoCustom ? NoCustom : Custom> => {
  const normalized = {} as NormalizedShapes<Shapes>;
  // Flat dotted-keyed rebuild — same generic-object assertion idiom as before, now fed recursively.
  collectNormalizedInto(shapes, "", normalized as Record<string, NormalizedShape>);

  const spec: Record<string, StoreSpec[string]> = {};
  for (const [shapeKey, shape] of Object.entries(normalized)) {
    spec[shapeKey] = storeAppend(shape.row);
    spec[readSpecKey(shapeKey)] = storeQuery({
      from: shapeKey,
      payload: storeReadPayloadSchema,
      result: Schema.Array(shape.row),
    });
  }

  const shapeBindings: Array<ShapeBinding> = [];
  let custom = {} as Custom extends NoCustom ? NoCustom : Custom;
  let customEntries: Readonly<Record<string, CustomMethodEntry>> = {};

  if (methods !== undefined) {
    const compiled = compileCustomMethods(
      shapes,
      methods as unknown as (handles: ShapeHandles<Shapes>) => Custom,
      shapeBindings,
    );
    custom = compiled.custom as Custom extends NoCustom ? NoCustom : Custom;
    customEntries = compiled.customEntries;
  } else {
    makeShapeHandles(shapes, shapeBindings);
  }

  return {
    [storeContractSym]: storeContractSym,
    shapes,
    normalized,
    spec: spec as StoreSpec,
    custom: custom as Custom extends NoCustom ? NoCustom : Custom,
    customEntries,
    shapeBindings,
  };
};

/** @internal */
export function compileStoreContract<const Shapes extends StoreShapes>(
  shapes: Shapes,
): StoreContractDef<Shapes>;
/** @internal */
export function compileStoreContract<
  const Shapes extends StoreShapes,
  const Custom extends Readonly<Record<string, unknown>>,
>(
  shapes: Shapes,
  methods: (handles: ShapeHandles<Shapes>) => Custom,
): StoreContractDef<Shapes, Custom>;
/** @internal */
export function compileStoreContract(
  shapes: StoreShapes,
  methods?: (handles: ShapeHandles<StoreShapes>) => Readonly<Record<string, unknown>>,
): StoreContractDef<StoreShapes, Readonly<Record<string, unknown>> | NoCustom> {
  return compileStoreContractBody(shapes, methods);
}

/** @internal */
export function makeStoreContractValue<const Shapes extends StoreShapes>(
  shapes: Shapes,
): StoreContractValue<Shapes>;
/** @internal */
export function makeStoreContractValue<
  const Shapes extends StoreShapes,
  const Custom extends Readonly<Record<string, unknown>>,
>(
  shapes: Shapes,
  methods: (handles: ShapeHandles<Shapes>) => Custom,
): StoreContractValue<Shapes, Custom>;
/** @internal */
export function makeStoreContractValue(
  shapes: StoreShapes,
  methods?: (handles: ShapeHandles<StoreShapes>) => Readonly<Record<string, unknown>>,
): StoreContractValue {
  return Object.assign(
    Object.create(Pipeable.Prototype),
    compileStoreContractBody(shapes, methods),
  ) as StoreContractValue;
}

/** @internal */
export type MergedCustom<
  Base extends StoreContractValue,
  Methods,
> = Methods extends (handles: ShapeHandles<infer _Shapes>) => infer Custom
  ? Custom extends Readonly<Record<string, unknown>>
    ? Base["custom"] & Custom
    : Base["custom"]
  : Methods extends (handles: ShapeHandles<StoreShapes>) => infer Custom
    ? Custom extends Readonly<Record<string, unknown>>
      ? Base["custom"] & Custom
      : Base["custom"]
    : Base["custom"];

/** Merge base custom with extension methods inferred via `const` on the callback. @internal */
export type ExtendCustom<
  Base extends StoreContractValue,
  Added extends Readonly<Record<string, unknown>>,
> = keyof Added extends never ? Base["custom"] : Base["custom"] & Added;

/** Extract the custom-method record from a contract methods callback. @internal */
export type MethodsReturn<M> = M extends (handles: infer _H) => infer R ? R : never;

type MergeShapes<
  A extends StoreContractValue,
  B extends StoreShapes | undefined,
> = B extends StoreShapes ? A["shapes"] & B : A["shapes"];

type MergeHandles<
  A extends StoreContractValue,
  B extends StoreShapes | undefined,
> = ShapeHandles<MergeShapes<A, B>>;

export const mergeStoreContractsBody = <
  const A extends StoreContractValue,
  const B extends StoreShapes | undefined,
  const Methods extends
    | ((handles: MergeHandles<A, B>) => Readonly<Record<string, unknown>>)
    | undefined = undefined,
>(
  base: A,
  shapes: B,
  methods?: Methods,
): StoreContractValue<
  MergeShapes<A, B>,
  Methods extends undefined ? A["custom"] : ExtendCustom<A, MethodsReturn<Methods>>
> => {
  const mergedShapes = { ...base.shapes, ...shapes } as MergeShapes<A, B>;
  for (const key of Object.keys(shapes ?? {})) {
    if (key in base.shapes) {
      throw new Error(`Store.extend: shape "${key}" is already declared on the contract`);
    }
  }

  const mergedNormalized = {} as NormalizedShapes<MergeShapes<A, B>>;
  collectNormalizedInto(mergedShapes, "", mergedNormalized as Record<string, NormalizedShape>);

  const shapeBindings: Array<ShapeBinding> = [...base.shapeBindings];
  const boundKeys = new Set(shapeBindings.map((binding) => binding.shapeKey));
  for (const shapeKey of Object.keys(mergedNormalized)) {
    if (!boundKeys.has(shapeKey)) {
      shapeBindings.push({ shapeKey, append: undefined, read: undefined });
      boundKeys.add(shapeKey);
    }
  }

  let mergedCustom: Readonly<Record<string, unknown>> = { ...base.custom };
  const customEntries: Record<string, CustomMethodEntry> = { ...base.customEntries };

  if (methods !== undefined) {
    const { handles, aliasByFn } = makeShapeHandles(mergedShapes, shapeBindings);
    const built = methods(handles as MergeHandles<A, B>);
    assertDisjointCustomKeys(mergedShapes, Object.keys(built));
    mergedCustom = { ...mergedCustom, ...built };
    for (const [methodName, value] of Object.entries(built)) {
      customEntries[methodName] = classifyCustomMethod(methodName, value, aliasByFn);
    }
  }

  const spec: Record<string, StoreSpec[string]> = {};
  for (const [shapeKey, shape] of Object.entries(mergedNormalized)) {
    spec[shapeKey] = storeAppend(shape.row);
    spec[readSpecKey(shapeKey)] = storeQuery({
      from: shapeKey,
      payload: storeReadPayloadSchema,
      result: Schema.Array(shape.row),
    });
  }

  return Object.assign(Object.create(Pipeable.Prototype), {
    [storeContractSym]: storeContractSym,
    shapes: mergedShapes,
    normalized: mergedNormalized,
    spec: spec as StoreSpec,
    custom: mergedCustom,
    customEntries,
    shapeBindings,
  }) as StoreContractValue<
    MergeShapes<A, B>,
    Methods extends undefined ? A["custom"] : ExtendCustom<A, MethodsReturn<Methods>>
  >;
};

/** @internal */
export function mergeStoreContracts<const A extends StoreContractValue>(
  base: A,
): StoreContractValue<A["shapes"], A["custom"]>;
/** @internal */
export function mergeStoreContracts<
  const A extends StoreContractValue,
  const B extends StoreShapes,
>(
  base: A,
  shapes: B,
): StoreContractValue<A["shapes"] & B, A["custom"]>;
/** @internal */
export function mergeStoreContracts<
  const A extends StoreContractValue,
  const Added extends Readonly<Record<string, unknown>>,
>(
  base: A,
  shapes: undefined,
  methods: (handles: ShapeHandles<A["shapes"]>) => Added,
): StoreContractValue<A["shapes"], ExtendCustom<A, Added>>;
/** @internal */
export function mergeStoreContracts<
  const A extends StoreContractValue,
  const B extends StoreShapes,
  const Added extends Readonly<Record<string, unknown>>,
>(
  base: A,
  shapes: B,
  methods: (handles: ShapeHandles<A["shapes"] & B>) => Added,
): StoreContractValue<A["shapes"] & B, ExtendCustom<A, Added>>;
/** @internal */
export function mergeStoreContracts(
  base: StoreContractValue,
  shapes?: StoreShapes,
  methods?: StoreMethodsFn<StoreShapes>,
): StoreContractValue {
  return mergeStoreContractsBody(base, shapes, methods);
};

/**
 * Set a value at a (possibly dotted) path in the resolved-handle tree, creating intermediate groups.
 * Mirrors `Hyperlink.setPath`. @internal
 */
const setHandlePath = (
  obj: Record<string, unknown>,
  path: string,
  val: unknown,
): void => {
  const parts = path.split(".");
  const last = parts.pop();
  if (last === undefined) {
    return;
  }
  let node = obj;
  for (const part of parts) {
    // Same tree-walk `as Record<string, unknown>` idiom as `Hyperlink.nestService`/`setPath`.
    node[part] = (node[part] as Record<string, unknown> | undefined) ?? {};
    node = node[part] as Record<string, unknown>;
  }
  node[last] = val;
};

/**
 * Nest a flat dotted-key resolved handle back into the shape tree so `handle.sensors.temperature.append`
 * works. **Identity (same reference) when there are no dotted keys**, so a flat contract's handle is
 * byte-identical to before. Mirrors `Hyperlink.nestService`. @internal
 */
export const nestHandle = (flat: Record<string, unknown>): Record<string, unknown> => {
  if (!Object.keys(flat).some((key) => key.includes("."))) {
    return flat;
  }
  const nested: Record<string, unknown> = {};
  for (const [path, val] of Object.entries(flat)) {
    setHandlePath(nested, path, val);
  }
  return nested;
};

/** @internal */
export const materializeContractHandle = (
  contract: StoreContractValue,
  sideEffects: AppendSideEffects,
): Record<string, unknown> => {
  const flat = makeScopeHandle(contract.spec, sideEffects) as Record<
    string,
    (payload: unknown) => Effect.Effect<unknown>
  >;

  for (const binding of contract.shapeBindings) {
    binding.append = flat[binding.shapeKey]!;
    binding.read = (payload?: unknown) => flat[readSpecKey(binding.shapeKey)]!(payload ?? {});
  }

  const handle: Record<string, unknown> = {};

  for (const shapeKey of Object.keys(contract.normalized)) {
    const appendOne = flat[shapeKey]!;
    handle[shapeKey] = {
      append: (input: unknown) => appendMany(appendOne, input),
      read: (payload?: unknown) => flat[readSpecKey(shapeKey)]!(payload ?? {}),
    };
  }

  for (const [methodName, entry] of Object.entries(contract.customEntries)) {
    switch (entry._tag) {
      case CUSTOM_APPEND_ALIAS: {
        const nested = handle[entry.shapeKey] as {
          readonly append: (input: unknown) => Effect.Effect<void>;
        };
        handle[methodName] = nested.append;
        break;
      }
      case CUSTOM_READ_ALIAS: {
        const nested = handle[entry.shapeKey] as {
          readonly read: (payload?: unknown) => Effect.Effect<unknown>;
        };
        handle[methodName] = nested.read;
        break;
      }
      case CUSTOM_EFFECT:
        handle[methodName] = entry.effect;
        break;
      case CUSTOM_FN:
        handle[methodName] = entry.fn;
        break;
    }
  }

  // Shape entries are keyed by dotted path; fold them into the nested tree (identity for flat contracts).
  return nestHandle(handle);
};
