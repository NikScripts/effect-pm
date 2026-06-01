/**
 * Runtime state scopes for telemetry emitters.
 *
 * @module State
 */

import { Context, Effect, Layer, Schema } from "effect";

type StructFields = Schema.Struct.Fields;
type StructFromFields<Fields extends StructFields> = Schema.Struct<Fields>;
type ValueOf<Fields extends StructFields> = Schema.Struct.Type<Fields>;

type StateSchemaTree = {
  readonly fields: StructFields;
  readonly children: Readonly<Record<string, StateSchemaTree>>;
};

type SchemaSelectorTree<Fields extends StructFields> = Fields & {
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
    readonly Leaf: LeafFields;
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
  readonly withState: <ChildSelf>() => <
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

const buildSelectors = (tree: StateSchemaTree): SchemaSelectorTree<StructFields> => {
  const out: Record<PropertyKey, unknown> = {};
  for (const key of Reflect.ownKeys(tree.fields)) {
    out[key] = tree.fields[key];
  }
  for (const [key, child] of Object.entries(tree.children)) {
    out[key] = buildSelectors(child);
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
  const StateSelectors = buildSelectors(options.tree) as StateSelectors;
  const Base = Context.Service<Self, StateShape>()(options.id);

  class ScopeClass extends Base {
    static readonly Leaf = Leaf;
    static readonly State = StateSchema;
    static readonly Schema = {
      Leaf: options.leafFields,
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

    static readonly withState =
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
      Fields,
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
    export type Leaf<S extends { readonly Leaf: Schema.Top }> =
      Schema.Schema.Type<S["Leaf"]>;
    export type State<S extends { readonly State: Schema.Top }> =
      Schema.Schema.Type<S["State"]>;
  }
}
