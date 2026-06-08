/**
 * Runtime state scopes for telemetry emitters.
 *
 * A scope is a `Context.Service` class carrying a typed state tree. Declare the
 * root with `class X extends State.Scope(serviceOrId)({ fields })` and nest
 * leaves with `class Y extends X.withLeaf("Key", { fields })`.
 *
 * Identity: when a domain service/tag is passed, the scope id is its `.key`;
 * when a string is passed, that string is the id. Leaf ids derive as
 * `` `${parentId}/${Key}` ``.
 *
 * `kind` is the domain discriminator consumed by the storage telemetry DSL
 * (`processType`). It defaults to the id's last `/` segment and is inherited by
 * leaves; pass it explicitly when the domain name differs from that segment.
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

/**
 * A domain service/tag (id taken from its `.key`) or an explicit id string.
 *
 * @public
 */
export type ScopeIdentity = string | { readonly key: string };

type IdOf<S extends ScopeIdentity> = S extends string
  ? S
  : S extends { readonly key: infer K extends string }
    ? K
    : never;

export type StateScope<
  Id extends string,
  LeafFields extends StructFields,
  StateFields extends StructFields,
  StateShape,
  StateSelectors,
  Path extends ReadonlyArray<string>,
  Requirements,
> = Context.ServiceClass<Id, Id, StateShape> & {
  readonly id: Id;
  readonly kind: string;
  readonly Leaf: StructFromFields<LeafFields>;
  readonly State: StructFromFields<StateFields>;
  readonly Schema: {
    readonly Leaf: StateFieldSelectors<LeafFields>;
    readonly State: StateSelectors;
  };
  readonly layer: (leaf: ValueOf<LeafFields>) => Layer.Layer<Id, never, Requirements>;
  readonly provide: (
    leaf: ValueOf<LeafFields>,
  ) => <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, Exclude<R, Id> | Requirements>;
  readonly run: <A, E, R>(
    leaf: ValueOf<LeafFields>,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, Exclude<R, Id> | Requirements>;
  readonly withLeaf: <
    const Key extends string,
    const ChildFields extends StructFields,
  >(
    key: Key,
    fields: ChildFields,
  ) => StateScope<
    `${Id}/${Key}`,
    ChildFields,
    InsertState<StateFields, Path, Key, { readonly [K in keyof ChildFields]: ChildFields[K] }>,
    InsertState<StateShape, Path, Key, ValueOf<ChildFields>>,
    InsertSelectors<StateSelectors, Path, Key, ChildFields>,
    readonly [...Path, Key],
    Requirements | Id
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

const makeScope = <
  const Id extends string,
  const LeafFields extends StructFields,
  StateFields extends StructFields,
  StateShape,
  StateSelectors,
  const Path extends ReadonlyArray<string>,
  Requirements,
>(options: {
  readonly id: Id;
  readonly kind: string;
  readonly leafFields: LeafFields;
  readonly tree: StateSchemaTree;
  readonly path: Path;
  readonly makeState: (leaf: ValueOf<LeafFields>) => Effect.Effect<StateShape, never, Requirements>;
}): StateScope<
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
  const Base = Context.Service<Id, StateShape>()(options.id);
  const scope = Object.assign(Base, {
    id: options.id,
    kind: options.kind,
    Leaf,
    State: StateSchema,
    Schema: {
      Leaf: LeafSelectors,
      State: StateSelectors,
    },
    layer: (leaf: ValueOf<LeafFields>) =>
      Layer.effect(Base, options.makeState(leaf)),
    provide:
      (leaf: ValueOf<LeafFields>) =>
      <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        effect.pipe(Effect.provide(scope.layer(leaf))),
    run: <A, E, R>(
      leaf: ValueOf<LeafFields>,
      effect: Effect.Effect<A, E, R>,
    ) => scope.provide(leaf)(effect),
    withLeaf: <const Key extends string, const ChildFields extends StructFields>(
      key: Key,
      fields: ChildFields,
    ) => {
      const childTree = makeTree(fields);
      const tree = cloneTreeWithChild(options.tree, options.path, key, childTree);
      const path = [...options.path, key] as const;
      const childId: `${Id}/${Key}` = `${options.id}/${key}`;
      return makeScope<
        `${Id}/${Key}`,
        ChildFields,
        InsertState<StateFields, Path, Key, { readonly [K in keyof ChildFields]: ChildFields[K] }>,
        InsertState<StateShape, Path, Key, ValueOf<ChildFields>>,
        InsertSelectors<StateSelectors, Path, Key, ChildFields>,
        typeof path,
        Requirements | Id
      >({
        id: childId,
        kind: options.kind,
        leafFields: fields,
        tree,
        path,
        makeState: (leaf) =>
          Effect.map(scope, (parent) =>
            insertStateValue(parent, options.path, key, leaf),
          ) as Effect.Effect<
            InsertState<StateShape, Path, Key, ValueOf<ChildFields>>,
            never,
            Requirements | Id
          >,
      });
    },
  });
  return scope as StateScope<
    Id,
    LeafFields,
    StateFields,
    StateShape,
    StateSelectors,
    Path,
    Requirements
  >;
};

const resolveScopeId = (serviceOrId: ScopeIdentity): string =>
  typeof serviceOrId === "string" ? serviceOrId : serviceOrId.key;

const lastSegment = (id: string): string => {
  const segments = id.split("/");
  return segments[segments.length - 1] ?? id;
};

const Scope =
  <const ServiceOrId extends ScopeIdentity>(
    serviceOrId: ServiceOrId,
    kind?: string,
  ) =>
  <const Fields extends StructFields>(fields: Fields) => {
    const id = resolveScopeId(serviceOrId);
    return makeScope<
      IdOf<ServiceOrId>,
      Fields,
      Fields,
      ValueOf<Fields>,
      StateFieldSelectors<Fields>,
      readonly [],
      never
    >({
      id: id as IdOf<ServiceOrId>,
      kind: kind ?? lastSegment(id),
      leafFields: fields,
      tree: makeTree(fields),
      path: [],
      makeState: (leaf) => Effect.succeed(leaf),
    });
  };

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
  export namespace Type {
    export type Leaf<S extends { readonly Leaf: Schema.Top }> =
      Schema.Schema.Type<S["Leaf"]>;
    export type State<S extends { readonly State: Schema.Top }> =
      Schema.Schema.Type<S["State"]>;
  }
}
