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
import { makeScopeHandle } from "./memoryScope";
import type { AppendSideEffects } from "./memoryScope";
import type { StoreSpec } from "./spec";

export const storeContractSym = Symbol.for("@nikscripts/effect-pm/Store/contractDef");
export const storeShapeSym = Symbol.for("@nikscripts/effect-pm/Store/shape");

export const emptyPayloadSchema = Schema.Struct({});
/** @internal */
export type EmptyReadPayload = typeof emptyPayloadSchema.Type;

/** True when the read payload is an empty struct schema. @internal */
export const isEmptyReadSchema = (schema: Schema.Schema<unknown>): boolean =>
  schema === emptyPayloadSchema ||
  (Schema.isSchema(schema) &&
    "fields" in schema &&
    typeof schema.fields === "object" &&
    schema.fields !== null &&
    Object.keys(schema.fields).length === 0);

/** Normalize empty read schemas to {@link emptyPayloadSchema}. @internal */
export const normalizeReadSchema = (
  schema: Schema.Schema<unknown>,
): Schema.Schema<unknown> => (isEmptyReadSchema(schema) ? emptyPayloadSchema : schema);

/** Row + read-query payload for one shape. @internal */
export interface StoreShapeDef<
  Row extends Schema.Schema<unknown> = Schema.Schema<unknown>,
  Read extends Schema.Schema<unknown> = typeof emptyPayloadSchema,
> {
  readonly [storeShapeSym]: typeof storeShapeSym;
  readonly row: Row;
  readonly read: Read;
}

/** Part 1 shape value — row schema or {@link StoreShapeDef}. @internal */
export type StoreShapeInput = Schema.Schema<unknown> | StoreShapeDef;

/** @internal */
export type NormalizedShape = {
  readonly row: Schema.Schema<unknown>;
  readonly read: Schema.Schema<unknown>;
};

/** @internal */
export type StoreShapes = Readonly<Record<string, StoreShapeInput>>;

/** @internal */
export type NormalizedShapes<Shapes extends StoreShapes> = {
  readonly [K in keyof Shapes & string]: NormalizeShape<Shapes[K]>;
};

/** @internal */
export type NormalizeShape<S extends StoreShapeInput> = S extends StoreShapeDef<
  infer Row,
  infer Read
>
  ? { readonly row: Row; readonly read: Read }
  : S extends Schema.Schema<infer _A>
    ? { readonly row: S; readonly read: typeof emptyPayloadSchema }
    : never;

export const CUSTOM_READ_ALIAS = "Store/customReadAlias" as const;
export const CUSTOM_APPEND_ALIAS = "Store/customAppendAlias" as const;
export const CUSTOM_EFFECT = "Store/customEffect" as const;
export const CUSTOM_FN = "Store/customFn" as const;

/** Compiled custom method entry. @internal */
export type CustomMethodEntry =
  | { readonly _tag: typeof CUSTOM_READ_ALIAS; readonly shapeKey: string }
  | { readonly _tag: typeof CUSTOM_APPEND_ALIAS; readonly shapeKey: string }
  | { readonly _tag: typeof CUSTOM_EFFECT; readonly effect: Effect.Effect<unknown, unknown, unknown> }
  | {
      readonly _tag: typeof CUSTOM_FN;
      readonly fn: (payload: unknown) => Effect.Effect<unknown>;
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

/** True when every key in `P` is optional (or `P` is empty). @internal */
type AllKeysOptional<P> = { [K in keyof P]-?: {} extends Pick<P, K> ? true : false }[keyof P];

/** Optional read payload for empty structs or structs whose fields are all optional. @internal */
export type IsOptionalReadPayload<P> = keyof P extends never
  ? true
  : AllKeysOptional<P> extends true
    ? true
    : false;

/** Inlined append/read members — expanded for readable hovers (not alias names). @internal */
export type ShapeNamespaceMembers<
  Row extends Schema.Schema<unknown>,
  Read extends Schema.Schema<unknown>,
> = {
  readonly append: (
    row: SchemaDecoded<Row> | ReadonlyArray<SchemaDecoded<Row>>,
  ) => Effect.Effect<void>;
  readonly read: IsOptionalReadPayload<Schema.Schema.Type<Read>> extends true
    ? (payload?: SchemaDecoded<Read>) => Effect.Effect<ReadonlyArray<SchemaDecoded<Row>>>
    : (payload: SchemaDecoded<Read>) => Effect.Effect<ReadonlyArray<SchemaDecoded<Row>>>;
};

/** @internal */
export type ShapeReadFn<
  Row extends Schema.Schema<unknown>,
  Read extends Schema.Schema<unknown>,
> = ShapeNamespaceMembers<Row, Read>["read"];

/** @internal */
export type ShapeAppendFn<Row extends Schema.Schema<unknown>> =
  ShapeNamespaceMembers<Row, typeof emptyPayloadSchema>["append"];

/** @internal */
export type ShapeHandle<N extends NormalizedShape> = {
  readonly schema: N["row"];
  readonly readPayload: N["read"];
  readonly append: ShapeAppendFn<N["row"]>;
  readonly read: ShapeReadFn<N["row"], N["read"]>;
};

/** @internal */
export type ShapeHandles<Shapes extends StoreShapes> = {
  readonly [K in keyof Shapes & string]: ShapeHandle<NormalizeShape<Shapes[K]>>;
};

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

/** @internal */
export const isStoreShapeInput = (value: unknown): value is StoreShapeInput =>
  Schema.isSchema(value) || isStoreShapeDef(value);

/** @internal */
export const normalizeShapeInput = (input: StoreShapeInput): NormalizedShape =>
  isStoreShapeDef(input)
    ? { row: input.row, read: normalizeReadSchema(input.read) }
    : { row: input, read: emptyPayloadSchema };

/** @internal */
export function makeStoreShape(
  row: Schema.Schema<unknown>,
  read?: Schema.Schema<unknown>,
): StoreShapeDef {
  return {
    [storeShapeSym]: storeShapeSym,
    row,
    read: read === undefined ? emptyPayloadSchema : normalizeReadSchema(read),
  } as StoreShapeDef;
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

const makeShapeHandles = <const Shapes extends StoreShapes>(
  shapes: Shapes,
  bindings: Array<ShapeBinding>,
): ShapeHandles<Shapes> => {
  const handles = {} as ShapeHandles<Shapes>;
  const bindingByKey = new Map(bindings.map((binding) => [binding.shapeKey, binding]));

  for (const key of Object.keys(shapes) as Array<keyof Shapes & string>) {
    const normalized = normalizeShapeInput(shapes[key]!);
    let binding = bindingByKey.get(key);
    if (binding === undefined) {
      binding = { shapeKey: key, append: undefined, read: undefined };
      bindings.push(binding);
      bindingByKey.set(key, binding);
    }

    const append = ((input: unknown) =>
      Effect.suspend(() => {
        if (binding!.append === undefined) {
          return Effect.die(
            new StoreShapeNotMaterialized({ shapeKey: key, operation: "append" }),
          );
        }
        return appendMany(binding!.append, input);
      })) as ShapeAppendFn<typeof normalized.row>;

    const read = ((payload?: unknown) =>
      Effect.suspend(() => {
        if (binding!.read === undefined) {
          return Effect.die(
            new StoreShapeNotMaterialized({ shapeKey: key, operation: "read" }),
          );
        }
        return binding!.read(payload ?? {});
      })) as ShapeReadFn<typeof normalized.row, typeof normalized.read>;

    (handles as Record<string, unknown>)[key] = {
      schema: normalized.row,
      readPayload: normalized.read,
      append,
      read,
    };
  }
  return handles;
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

const classifyCustomMethod = <Shapes extends StoreShapes>(
  methodName: string,
  value: unknown,
  handles: ShapeHandles<Shapes>,
): CustomMethodEntry => {
  for (const [shapeKey, handle] of Object.entries(handles)) {
    if (value === handle.read) {
      return { _tag: CUSTOM_READ_ALIAS, shapeKey };
    }
    if (value === handle.append) {
      return { _tag: CUSTOM_APPEND_ALIAS, shapeKey };
    }
  }
  if (Effect.isEffect(value)) {
    return {
      _tag: CUSTOM_EFFECT,
      effect: value as Effect.Effect<unknown, unknown, unknown>,
    };
  }
  if (typeof value === "function") {
    return { _tag: CUSTOM_FN, fn: value as (payload: unknown) => Effect.Effect<unknown> };
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
  const handles = makeShapeHandles(shapes, bindings);
  const built = methods(handles);
  assertDisjointCustomKeys(shapes, Object.keys(built));
  const customEntries: Record<string, CustomMethodEntry> = {};
  for (const [methodName, value] of Object.entries(built)) {
    customEntries[methodName] = classifyCustomMethod(methodName, value, handles);
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
  for (const key of Object.keys(shapes) as Array<keyof Shapes & string>) {
    (normalized as Record<string, NormalizedShape>)[key] = normalizeShapeInput(shapes[key]!);
  }

  const spec: Record<string, StoreSpec[string]> = {};
  for (const [shapeKey, shape] of Object.entries(normalized)) {
    spec[shapeKey] = storeAppend(shape.row);
    spec[readSpecKey(shapeKey)] = storeQuery({
      from: shapeKey,
      payload: shape.read,
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
> = Methods extends (handles: ShapeHandles<StoreShapes>) => infer Custom
  ? Custom extends Readonly<Record<string, unknown>>
    ? Base["custom"] & Custom
    : Base["custom"]
  : Base["custom"];

/** @internal */
export const mergeStoreContracts = <
  const A extends StoreContractValue,
  const B extends StoreShapes,
>(
  base: A,
  shapes?: B,
  methods?: StoreMethodsFn<A["shapes"] & B>,
): StoreContractValue<A["shapes"] & B, MergedCustom<A, typeof methods>> => {
  const mergedShapes = { ...base.shapes, ...shapes } as A["shapes"] & B;
  for (const key of Object.keys(shapes ?? {})) {
    if (key in base.shapes) {
      throw new Error(`Store.extend: shape "${key}" is already declared on the contract`);
    }
  }

  const mergedNormalized = {} as NormalizedShapes<A["shapes"] & B>;
  for (const [key, input] of Object.entries(mergedShapes)) {
    (mergedNormalized as Record<string, NormalizedShape>)[key] = normalizeShapeInput(input);
  }

  const shapeBindings: Array<ShapeBinding> = [...base.shapeBindings];
  const boundKeys = new Set(shapeBindings.map((binding) => binding.shapeKey));
  for (const key of Object.keys(mergedShapes)) {
    if (!boundKeys.has(key)) {
      shapeBindings.push({ shapeKey: key, append: undefined, read: undefined });
      boundKeys.add(key);
    }
  }

  let mergedCustom: Readonly<Record<string, unknown>> = { ...base.custom };
  const customEntries: Record<string, CustomMethodEntry> = { ...base.customEntries };

  if (methods !== undefined) {
    const handles = makeShapeHandles(mergedShapes, shapeBindings);
    const built = methods(handles);
    assertDisjointCustomKeys(mergedShapes, Object.keys(built));
    mergedCustom = { ...mergedCustom, ...built };
    for (const [methodName, value] of Object.entries(built)) {
      customEntries[methodName] = classifyCustomMethod(methodName, value, handles);
    }
  }

  const spec: Record<string, StoreSpec[string]> = {};
  for (const [shapeKey, shape] of Object.entries(mergedNormalized)) {
    spec[shapeKey] = storeAppend(shape.row);
    spec[readSpecKey(shapeKey)] = storeQuery({
      from: shapeKey,
      payload: shape.read,
      result: Schema.Array(shape.row),
    });
  }

  return Object.assign(Object.create(Pipeable.Prototype), {
    [storeContractSym]: storeContractSym,
    shapes: mergedShapes,
    normalized: mergedNormalized,
    spec: spec as StoreSpec,
    custom: mergedCustom as MergedCustom<A, typeof methods>,
    customEntries,
    shapeBindings,
  }) as StoreContractValue<A["shapes"] & B, MergedCustom<A, typeof methods>>;
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

  return handle;
};
