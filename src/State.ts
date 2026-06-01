/**
 * Runtime state scopes for telemetry emitters.
 *
 * @module State
 */

import { Context, Effect, Layer, Schema } from "effect";

type StructFields = Schema.Struct.Fields;
type StructFromFields<Fields extends StructFields> = Schema.Struct<Fields>;
type ValueOf<Fields extends StructFields> = Schema.Struct.Type<Fields>;

export const StateFieldSelectorTypeId = Symbol.for(
  "@nikscripts/effect-pm/State/FieldSelector",
);

export interface StateFieldSelectorMetadata {
  readonly path: ReadonlyArray<string>;
}

export type StateFieldSelector = Schema.Top & {
  readonly [StateFieldSelectorTypeId]: StateFieldSelectorMetadata;
};

export type StateFieldSelectors<Fields extends StructFields> = {
  readonly [K in keyof Fields]: StateFieldSelector;
};

type StateSchemaTree = {
  readonly fields: StructFields;
  readonly children: Readonly<Record<string, StateSchemaTree>>;
};

type SchemaSelectorTree<Fields extends StructFields> = StateFieldSelectors<Fields> & {
  readonly [key: string]: SchemaSelectorTree<StructFields>;
};

type InsertState<
  Parent,
  Path extends ReadonlyArray<string>,
  Key extends string,
  Child,
> = Path extends readonly []
  ? Parent & { readonly [K in Key]: Child }
  : Path extends readonly [
      infer Head extends keyof Parent & string,
      ...infer Tail extends ReadonlyArray<string>,
    ]
    ? Omit<Parent, Head> & {
        readonly [K in Head]: InsertState<Parent[Head], Tail, Key, Child>;
      }
    : never;

type InsertSelectors<
  Parent,
  Path extends ReadonlyArray<string>,
  Key extends string,
  Child,
> = Path extends readonly []
  ? Parent & { readonly [K in Key]: Child }
  : Path extends readonly [
      infer Head extends keyof Parent & string,
      ...infer Tail extends ReadonlyArray<string>,
    ]
    ? Omit<Parent, Head> & {
        readonly [K in Head]: InsertSelectors<Parent[Head], Tail, Key, Child>;
      }
    : never;

type StateScopeClass<
  Self,
  Id extends string,
  LeafFields extends StructFields,
  StateFields extends StructFields,
  StateShape,
  StateSelectors,
  Path extends ReadonlyArray<string>,
  Requirements,
> = {
  new(_: never): object;
} & Effect.Effect<StateShape, never, Self> & {
  readonly key: Id;
  readonly Leaf: StructFromFields<LeafFields>;
  readonly State: StructFromFields<StateFields>;
  readonly Schema: {
    readonly Leaf: StateFieldSelectors<LeafFields>;
    readonly State: StateSelectors;
  };
  readonly layer: (leaf: ValueOf<LeafFields>) => Layer.Layer<Self, never, Requirements>;
  readonly provide: (
    leaf: ValueOf<LeafFields>,
  ) => <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, Exclude<R, Self> | Requirements>;
  readonly run: <A, E, R>(
    leaf: ValueOf<LeafFields>,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, Exclude<R, Self> | Requirements>;
  readonly withLeaf: <ChildSelf>() => <
    const Key extends string,
    const ChildFields extends StructFields,
  >(
    key: Key,
    fields: ChildFields,
  ) => <const ChildId extends string>(
    id: ChildId,
  ) => StateScopeClass<
    ChildSelf,
    ChildId,
    ChildFields,
    InsertState<StateFields, Path, Key, { readonly [K in keyof ChildFields]: ChildFields[K] }>,
    InsertState<StateShape, Path, Key, ValueOf<ChildFields>>,
    InsertSelectors<StateSelectors, Path, Key, ChildFields>,
    readonly [...Path, Key],
    Requirements | Self
  >;
};

const makeTree = (fields: StructFields): StateSchemaTree => ({
  fields,
  children: {},
});

export const getStateFieldSelectorMetadata = (
  value: unknown,
): StateFieldSelectorMetadata | undefined =>
  typeof value === "object" &&
  value !== null &&
  StateFieldSelectorTypeId in value
    ? (value as { readonly [StateFieldSelectorTypeId]: StateFieldSelectorMetadata })[
        StateFieldSelectorTypeId
      ]
    : undefined;

const makeStateFieldSelector = (
  schema: Schema.Top,
  path: ReadonlyArray<string>,
): StateFieldSelector =>
  Object.assign(schema.annotate({}), {
    [StateFieldSelectorTypeId]: { path },
  });

const cloneTreeWithChild = (
  tree: StateSchemaTree,
  path: ReadonlyArray<string>,
  key: string,
  child: StateSchemaTree,
): StateSchemaTree => {
  if (path.length === 0) {
    return {
      fields: tree.fields,
      children: { ...tree.children, [key]: child },
    };
  }
  const [head, ...tail] = path;
  const current = head === undefined ? undefined : tree.children[head];
  if (head === undefined || current === undefined) {
    throw new Error(`State scope path is missing: ${path.join(".")}`);
  }
  return {
    fields: tree.fields,
    children: {
      ...tree.children,
      [head]: cloneTreeWithChild(current, tail, key, child),
    },
  };
};

const buildFields = (tree: StateSchemaTree): StructFields => {
  const fields: Record<PropertyKey, Schema.Top> = {};
  for (const key of Reflect.ownKeys(tree.fields)) {
    fields[key] = tree.fields[key] as Schema.Top;
  }
  for (const [key, child] of Object.entries(tree.children)) {
    fields[key] = Schema.Struct(buildFields(child));
  }
  return fields;
};

const buildSelectors = (
  tree: StateSchemaTree,
  path: ReadonlyArray<string>,
): SchemaSelectorTree<StructFields> => {
  const out: Record<PropertyKey, unknown> = {};
  for (const key of Reflect.ownKeys(tree.fields)) {
    out[key] = makeStateFieldSelector(
      tree.fields[key] as Schema.Top,
      [...path, String(key)],
    );
  }
  for (const [key, child] of Object.entries(tree.children)) {
    out[key] = buildSelectors(child, [...path, key]);
  }
  return out as SchemaSelectorTree<StructFields>;
};

const insertStateValue = (
  parent: unknown,
  path: ReadonlyArray<string>,
  key: string,
  child: unknown,
): unknown => {
  if (path.length === 0) {
    return { ...(parent as object), [key]: child };
  }
  const [head, ...tail] = path;
  if (head === undefined) {
    return parent;
  }
  const record = parent as Record<string, unknown>;
  return {
    ...record,
    [head]: insertStateValue(record[head], tail, key, child),
  };
};

const makeScopeClass = <
  Self,
  const Id extends string,
  const LeafFields extends StructFields,
  StateFields extends StructFields,
  StateShape,
  StateSelectors,
  const Path extends ReadonlyArray<string>,
  Requirements,
>(options: {
  readonly id: Id;
  readonly leafFields: LeafFields;
  readonly tree: StateSchemaTree;
  readonly path: Path;
  readonly makeState: (leaf: ValueOf<LeafFields>) => Effect.Effect<StateShape, never, Requirements>;
}): StateScopeClass<
  Self,
  Id,
  LeafFields,
  StateFields,
  StateShape,
  StateSelectors,
  Path,
  Requirements
> => {
  const Leaf = Schema.Struct(options.leafFields);
  const StateSchema = Schema.Struct(buildFields(options.tree)) as StructFromFields<StateFields>;
  const LeafSelectors = buildSelectors(
    makeTree(options.leafFields),
    options.path,
  ) as StateFieldSelectors<LeafFields>;
  const StateSelectors = buildSelectors(options.tree, []) as StateSelectors;
  const Base = Context.Service<Self, StateShape>()(options.id);

  class ScopeClass extends Base {
    static readonly Leaf = Leaf;
    static readonly State = StateSchema;
    static readonly Schema = {
      Leaf: LeafSelectors,
      State: StateSelectors,
    };

    static readonly layer = (leaf: ValueOf<LeafFields>) =>
      Layer.effect(ScopeClass, options.makeState(leaf));

    static readonly provide =
      (leaf: ValueOf<LeafFields>) =>
      <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        effect.pipe(Effect.provide(ScopeClass.layer(leaf)));

    static readonly run = <A, E, R>(
      leaf: ValueOf<LeafFields>,
      effect: Effect.Effect<A, E, R>,
    ) => ScopeClass.provide(leaf)(effect);

    static readonly withLeaf =
      <ChildSelf>() =>
      <const Key extends string, const ChildFields extends StructFields>(
        key: Key,
        fields: ChildFields,
      ) =>
      <const ChildId extends string>(id: ChildId) => {
        const childTree = makeTree(fields);
        const tree = cloneTreeWithChild(options.tree, options.path, key, childTree);
        const path = [...options.path, key] as const;
        return makeScopeClass<
          ChildSelf,
          ChildId,
          ChildFields,
          InsertState<StateFields, Path, Key, { readonly [K in keyof ChildFields]: ChildFields[K] }>,
          InsertState<StateShape, Path, Key, ValueOf<ChildFields>>,
          InsertSelectors<StateSelectors, Path, Key, ChildFields>,
          typeof path,
          Requirements | Self
        >({
          id,
          leafFields: fields,
          tree,
          path,
          makeState: (leaf) =>
            Effect.map(ScopeClass, (parent) =>
              insertStateValue(parent, options.path, key, leaf),
            ) as Effect.Effect<
              InsertState<StateShape, Path, Key, ValueOf<ChildFields>>,
              never,
              Requirements | Self
            >,
        });
      };
  }

  return ScopeClass as StateScopeClass<
    Self,
    Id,
    LeafFields,
    StateFields,
    StateShape,
    StateSelectors,
    Path,
    Requirements
  >;
};

const Scope =
  <Self>() =>
  <const Fields extends StructFields>(fields: Fields) =>
  <const Id extends string>(id: Id) =>
    makeScopeClass<
      Self,
      Id,
      Fields,
      Fields,
      ValueOf<Fields>,
      StateFieldSelectors<Fields>,
      readonly [],
      never
    >({
      id,
      leafFields: fields,
      tree: makeTree(fields),
      path: [],
      makeState: (leaf) => Effect.succeed(leaf),
    });

/**
 * State scope factory.
 *
 * @public
 */
export const State = {
  Scope,
} as const;

/**
 * Type helpers for {@link State}.
 *
 * @public
 */
export declare namespace State {
  export namespace Scope {
    export type Class<
      Self,
      Id extends string,
      LeafFields extends Schema.Struct.Fields,
    > = StateScopeClass<
      Self,
      Id,
      LeafFields,
      LeafFields,
      Schema.Struct.Type<LeafFields>,
      StateFieldSelectors<LeafFields>,
      readonly [],
      never
    >;
    export type AnyClass<
      Self = never,
      Leaf extends Record<PropertyKey, unknown> = Record<PropertyKey, unknown>,
      Requirements = never,
    > = {
      new(_: never): object;
    } & Effect.Effect<unknown, never, Self> & {
      readonly key: string;
      readonly Leaf: Schema.Top;
      readonly State: Schema.Top;
      readonly Schema: {
        readonly Leaf: { readonly [K in keyof Leaf]: StateFieldSelector };
        readonly State: Record<PropertyKey, unknown>;
      };
      readonly layer: (leaf: Leaf) => Layer.Layer<Self, never, Requirements>;
      readonly provide: (
        leaf: Leaf,
      ) => <A, E, R>(
        effect: Effect.Effect<A, E, R>,
      ) => Effect.Effect<A, E, Exclude<R, Self> | Requirements>;
      readonly run: <A, E, R>(
        leaf: Leaf,
        effect: Effect.Effect<A, E, R>,
      ) => Effect.Effect<A, E, Exclude<R, Self> | Requirements>;
    };
    export type ChildClass<
      Self,
      Id extends string,
      Parent,
      Key extends string,
      LeafFields extends Schema.Struct.Fields,
    > = Parent extends StateScopeClass<
      infer ParentSelf,
      string,
      Schema.Struct.Fields,
      infer ParentStateFields,
      infer ParentStateShape,
      infer ParentStateSelectors,
      infer ParentPath,
      infer ParentRequirements
    >
      ? StateScopeClass<
          Self,
          Id,
          LeafFields,
          InsertState<ParentStateFields, ParentPath, Key, { readonly [K in keyof LeafFields]: LeafFields[K] }>,
          InsertState<ParentStateShape, ParentPath, Key, Schema.Struct.Type<LeafFields>>,
          InsertSelectors<ParentStateSelectors, ParentPath, Key, LeafFields>,
          readonly [...ParentPath, Key],
          ParentRequirements | ParentSelf
        >
      : never;
    export type Leaf<S extends { readonly Leaf: Schema.Top }> =
      Schema.Schema.Type<S["Leaf"]>;
    export type State<S extends { readonly State: Schema.Top }> =
      Schema.Schema.Type<S["State"]>;
  }
}
