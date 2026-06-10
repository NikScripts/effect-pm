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

import { Context, Duration, Effect, Layer, Ref, Schema } from "effect";

type StructFields = Schema.Struct.Fields;
type StructFromFields<Fields extends StructFields> = Schema.Struct<Fields>;
type ValueOf<Fields extends StructFields> = Schema.Struct.Type<Fields>;

export const StateFieldSelectorTypeId: unique symbol = Symbol.for(
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
  LayerExtra = never,
> = Context.ServiceClass<Id, Id, StateShape> & {
  readonly id: Id;
  readonly kind: string;
  /** This scope's location in the state tree (root = `[]`). */
  readonly path: Path;
  /** This scope's own (leaf) field names — the filter for `State.previous`. */
  readonly leafKeys: ReadonlyArray<string>;
  readonly Leaf: StructFromFields<LeafFields>;
  readonly State: StructFromFields<StateFields>;
  readonly Schema: {
    readonly Leaf: StateFieldSelectors<LeafFields>;
    readonly State: StateSelectors;
  };
  readonly layer: (
    leaf: ValueOf<LeafFields>,
  ) => Layer.Layer<Id | LayerExtra, never, Requirements>;
  readonly provide: (
    leaf: ValueOf<LeafFields>,
  ) => <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, Exclude<R, Id | LayerExtra> | Requirements>;
  readonly run: <A, E, R>(
    leaf: ValueOf<LeafFields>,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, Exclude<R, Id | LayerExtra> | Requirements>;
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
    InsertSelectors<StateSelectors, Path, Key, StateFieldSelectors<ChildFields>>,
    readonly [...Path, Key],
    Requirements | Id,
    never
  >;
};

// ============================================================================
// State.Root — process-state envelope + transitions (telemetry)
// ============================================================================

/**
 * Process-state envelope owned by a root scope instance: the live `current`
 * tree plus the one-step-back `previous` snapshot (plus any spread from the
 * domain tag's optional `static Root`). {@link State.transition} is the only
 * writer; scopes are read-only views.
 *
 * @public
 */
export interface StateEnvelope<Current> {
  readonly previous: Current | null;
  readonly current: Current;
}

/**
 * Optional JSON config a domain tag may expose as `static Root`, spread onto the
 * envelope top level at layer init. `version` is required; `previous` / `current`
 * are forbidden (owned by the transition machinery).
 *
 * @public
 */
export type RootMetadata = {
  readonly version: string;
  readonly [key: string]: unknown;
} & {
  readonly previous?: never;
  readonly current?: never;
};

type EnvelopeShape = StateEnvelope<Record<string, unknown>> & Record<string, unknown>;

/**
 * Internal envelope `Ref` service. **v1:** one per runtime — a root scope's
 * `layer` provides it (per-domain id is a planned refinement). Internal only;
 * public code reaches the envelope via {@link State.Root} / {@link State.previous}
 * / {@link State.transition}.
 *
 * @internal
 */
export class StateRootRef extends Context.Service<
  StateRootRef,
  Ref.Ref<EnvelopeShape>
>()("@nikscripts/effect-pm/State/StateRootRef") {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const navigateSlice = (
  node: Record<string, unknown> | null,
  path: ReadonlyArray<string>,
): Record<string, unknown> | null => {
  let cur = node;
  for (const key of path) {
    if (cur === null) return null;
    const next = cur[key];
    cur = isRecord(next) ? next : null;
  }
  return cur;
};

const pickKeys = (
  node: Record<string, unknown>,
  keys: ReadonlyArray<string>,
): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in node) {
      out[key] = node[key];
    }
  }
  return out;
};

/** A scope's location + own field keys — the filter for {@link previousSlice}. */
interface ScopeView {
  readonly path: ReadonlyArray<string>;
  readonly leafKeys: ReadonlyArray<string>;
}

/** Full envelope — internal (materializer / transition emit) only. */
const Root: Effect.Effect<EnvelopeShape, never, StateRootRef> = Effect.flatMap(
  StateRootRef,
  (ref) => Ref.get(ref),
);

/**
 * Process-filtered slice of `envelope.previous` for a scope — symmetric to
 * `yield* scope` for `current`. `null` when there is no prior snapshot or the
 * scope's nest is absent in `previous`.
 */
const previousSlice = (
  scope: ScopeView,
): Effect.Effect<Record<string, unknown> | null, never, StateRootRef> =>
  Effect.map(Root, (env) => {
    if (env.previous === null) {
      return null;
    }
    const node = navigateSlice(env.previous, scope.path);
    return node === null ? null : pickKeys(node, scope.leafKeys);
  });

/**
 * Single COW transition: `previous` ← clone of `current`, `current` ← `update`
 * applied to a clone. Static-root spread keys are preserved. Internal only —
 * scopes never write the envelope directly.
 */
const transition = (
  update: (current: Record<string, unknown>) => Record<string, unknown>,
): Effect.Effect<void, never, StateRootRef> =>
  Effect.flatMap(StateRootRef, (ref) =>
    Ref.update(ref, (env) => ({
      ...env,
      previous: structuredClone(env.current),
      current: update(structuredClone(env.current)),
    })),
  );

/** Process-filtered slice of the live `envelope.current` for a scope. */
const currentSlice = (
  scope: ScopeView,
): Effect.Effect<Record<string, unknown>, never, StateRootRef> =>
  Effect.map(Root, (env) => {
    const node = navigateSlice(env.current, scope.path);
    return node === null ? {} : pickKeys(node, scope.leafKeys);
  });

const insertAtPath = (
  node: Record<string, unknown>,
  path: ReadonlyArray<string>,
  leaf: Record<string, unknown>,
): Record<string, unknown> => {
  const [head, ...rest] = path;
  if (head === undefined) {
    return { ...node, ...leaf };
  }
  if (rest.length === 0) {
    return { ...node, [head]: leaf };
  }
  const child = isRecord(node[head]) ? node[head] : {};
  return { ...node, [head]: insertAtPath(child, rest, leaf) };
};

const removeAtPath = (
  node: Record<string, unknown>,
  path: ReadonlyArray<string>,
): Record<string, unknown> => {
  const [head, ...rest] = path;
  if (head === undefined) {
    return node;
  }
  if (rest.length === 0) {
    const { [head]: _removed, ...keep } = node;
    return keep;
  }
  if (!isRecord(node[head])) {
    return node;
  }
  return { ...node, [head]: removeAtPath(node[head], rest) };
};

/**
 * Install (or replace) a scope's leaf nest in `envelope.current` — COW, via the
 * single-writer {@link transition}. Used on operation entry / `.provide`.
 */
const installLeaf = (
  scope: ScopeView,
  leaf: Record<string, unknown>,
): Effect.Effect<void, never, StateRootRef> =>
  transition((current) => insertAtPath(current, scope.path, leaf));

/**
 * Remove a scope's leaf nest from `envelope.current` — COW, via {@link transition}.
 * Used on operation exit (runner). Root scopes (`path === []`) are a no-op.
 */
const clearLeaf = (scope: ScopeView): Effect.Effect<void, never, StateRootRef> =>
  scope.path.length === 0
    ? Effect.void
    : transition((current) => removeAtPath(current, scope.path));

// ============================================================================
// Emit policy — per-field/event scheduling for State.Changed fan-out
// ============================================================================

/**
 * Internal runtime classification of how a state-field change (or event) is
 * scheduled onto the telemetry emit path. Authored via the {@link State} markers
 * (`immediateEmit` / `noEmit` / `deferEmit` / `debounceEmit` / `rateLimitEmit`)
 * and overridable per field via config ({@link EmitPolicyOverride}).
 *
 * @public
 */
export type EmitPolicy =
  | { readonly _tag: "immediate" }
  | { readonly _tag: "never" }
  | { readonly _tag: "defer" }
  | { readonly _tag: "debounce"; readonly duration: Duration.Duration }
  | { readonly _tag: "rateLimit"; readonly duration: Duration.Duration };

const immediateEmit: EmitPolicy = { _tag: "immediate" };
const noEmit: EmitPolicy = { _tag: "never" };
const deferEmit: EmitPolicy = { _tag: "defer" };
const debounceEmit = (duration: Duration.Input): EmitPolicy => ({
  _tag: "debounce",
  duration: Duration.fromInputUnsafe(duration),
});
const rateLimitEmit = (duration: Duration.Input): EmitPolicy => ({
  _tag: "rateLimit",
  duration: Duration.fromInputUnsafe(duration),
});

/**
 * Config-wire form of {@link EmitPolicy} (app overrides): a bare schedule tag or
 * a single-key duration object (e.g. `"never"`, `{ debounce: "250 millis" }`).
 *
 * **`"defer"` is intentionally absent** — defer is an author-only marker
 * (`State.deferEmit`), not a config override (requirements CHK-21). Decodes via
 * {@link decodeEmitPolicyOverride}.
 *
 * @public
 */
export const EmitPolicyOverrideSchema = Schema.Union([
  Schema.Literals(["immediate", "never"]),
  Schema.Struct({ debounce: Schema.String }),
  Schema.Struct({ rateLimit: Schema.String }),
]);

/** @public */
export type EmitPolicyOverride = typeof EmitPolicyOverrideSchema.Type;

/** Config durations arrive as runtime strings; `Duration` parses them. */
const configDuration = (value: string): Duration.Duration =>
  Duration.fromInputUnsafe(value as Duration.Input);

const decodeEmitPolicyOverride = (override: EmitPolicyOverride): EmitPolicy => {
  if (override === "immediate") {
    return immediateEmit;
  }
  if (override === "never") {
    return noEmit;
  }
  return "debounce" in override
    ? { _tag: "debounce", duration: configDuration(override.debounce) }
    : { _tag: "rateLimit", duration: configDuration(override.rateLimit) };
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
  LayerExtra = never,
>(options: {
  readonly id: Id;
  readonly kind: string;
  readonly leafFields: LeafFields;
  readonly tree: StateSchemaTree;
  readonly path: Path;
  readonly makeState: (leaf: ValueOf<LeafFields>) => Effect.Effect<StateShape, never, Requirements>;
  /** Top-level scopes own a {@link StateRootRef} envelope; leaves inherit it. */
  readonly provideEnvelope: boolean;
  /** Spread onto the envelope top level (domain tag `static Root`). */
  readonly rootMeta: Record<string, unknown>;
}): StateScope<
  Id,
  LeafFields,
  StateFields,
  StateShape,
  StateSelectors,
  Path,
  Requirements,
  LayerExtra
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
    path: options.path,
    leafKeys: Object.keys(options.leafFields),
    Leaf,
    State: StateSchema,
    Schema: {
      Leaf: LeafSelectors,
      State: StateSelectors,
    },
    layer: (leaf: ValueOf<LeafFields>) => {
      const baseLayer = Layer.effect(Base, options.makeState(leaf));
      if (!options.provideEnvelope) {
        return baseLayer;
      }
      const envelopeLayer = Layer.effect(
        StateRootRef,
        Effect.flatMap(options.makeState(leaf), (current) =>
          Ref.make<EnvelopeShape>({
            ...options.rootMeta,
            previous: null,
            current: current as Record<string, unknown>,
          }),
        ),
      );
      return Layer.merge(baseLayer, envelopeLayer);
    },
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
        InsertSelectors<StateSelectors, Path, Key, StateFieldSelectors<ChildFields>>,
        typeof path,
        Requirements | Id,
        never
      >({
        id: childId,
        kind: options.kind,
        leafFields: fields,
        tree,
        path,
        // Leaves never own an envelope — they share the root scope's via context.
        provideEnvelope: false,
        rootMeta: {},
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
    Requirements,
    LayerExtra
  >;
};

const resolveScopeId = (serviceOrId: ScopeIdentity): string =>
  typeof serviceOrId === "string" ? serviceOrId : serviceOrId.key;

/** A domain tag's optional `static Root` JSON, spread onto the envelope. */
const resolveRootMeta = (serviceOrId: ScopeIdentity): Record<string, unknown> => {
  if (typeof serviceOrId === "string") {
    return {};
  }
  const obj: Record<string, unknown> = serviceOrId;
  const meta = obj["Root"];
  return isRecord(meta) ? meta : {};
};

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
      never,
      StateRootRef
    >({
      id: id as IdOf<ServiceOrId>,
      kind: kind ?? lastSegment(id),
      leafFields: fields,
      tree: makeTree(fields),
      path: [],
      // Top-level scopes own the envelope; leaves inherit it via context.
      provideEnvelope: true,
      rootMeta: resolveRootMeta(serviceOrId),
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
  /** Full process-state envelope — internal (materializer / transition). */
  Root,
  /** Process-filtered slice of `envelope.previous` for a scope. */
  previous: previousSlice,
  /** Process-filtered slice of the live `envelope.current` for a scope. */
  currentSlice,
  /** Single COW transition of the envelope (internal writer). */
  transition,
  /** COW install/replace of a scope's leaf nest in `current` (op entry). */
  installLeaf,
  /** COW remove of a scope's leaf nest from `current` (op exit). */
  clearLeaf,
  // Emit-policy markers (author-time scheduling for State.Changed fan-out).
  immediateEmit,
  noEmit,
  deferEmit,
  debounceEmit,
  rateLimitEmit,
  /** Decode a config {@link EmitPolicyOverride} to an {@link EmitPolicy}. */
  decodeEmitPolicyOverride,
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
