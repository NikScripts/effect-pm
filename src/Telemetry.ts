/**
 * **Telemetry** — facet telemetry DSL (API 1: the `Telemetry.Tag` skeleton).
 *
 * This module owns the **author-time** surface: event schemas
 * ({@link Telemetry.Schema} + {@link Telemetry.terminal}) and the tree builders
 * ({@link Telemetry.namespace}, {@link Telemetry.group}, {@link Telemetry.operation},
 * {@link Telemetry.start}, {@link Telemetry.exit}, {@link Telemetry.event}) that
 * compose into a `Telemetry.Tag`.
 *
 * Wiring (`extend` / `bind` / log legs) and the runtime (materialize, runner,
 * emit to {@link TelemetryRouter}) live in separate modules — the Tag carries
 * **no** behavior, only structure, schemas, wire ids, and node handles.
 *
 * @module Telemetry
 */

import { Layer, Schema } from "effect";
import { isRecord } from "./internal/json";
import {
  getStateFieldSelectorMetadata,
} from "./State";
import { telemetryWireId, TelemetryRouter } from "./TelemetryRouter";

// ============================================================================
// Schema definition metadata
// ============================================================================

/** @internal */
export const TelemetrySchemaTypeId: unique symbol = Symbol.for(
  "@nikscripts/effect-pm/Telemetry/Schema",
);

const TELEMETRY_TERMINAL_KEY = "@nikscripts/effect-pm/Telemetry/Terminal" as const;
const TELEMETRY_INPUT_KEY = "@nikscripts/effect-pm/Telemetry/Input" as const;

type TelemetryTerminalKind = "clockMillis" | "durationMs";
type TelemetryInputKind = "errorString";

type TelemetryTerminal = { readonly [TELEMETRY_TERMINAL_KEY]: TelemetryTerminalKind };
type TelemetryInput = { readonly [TELEMETRY_INPUT_KEY]: TelemetryInputKind };

/** Nested {@link Telemetry.Schema} class reference allowed in field maps. */
type TelemetrySchemaFieldClass = TelemetrySchemaDefinition & {
  readonly Struct: Schema.Struct<Record<string, Schema.Top>>;
};

/** A telemetry-schema field: a `Schema.*`, a terminal/input marker, a nested schema class, or a literal. */
type TelemetrySchemaField =
  | Schema.Top
  | TelemetrySchemaFieldClass
  | TelemetryTerminal
  | TelemetryInput
  | string
  | number
  | boolean
  | null;

type TelemetrySchemaFields = Readonly<Record<string, TelemetrySchemaField>>;

/** Classification of how each schema field sources its value at materialize. */
type TelemetryInputFieldSource = TelemetryInputKind | "field";

/** @internal */
export interface TelemetryInputField {
  readonly field: string;
  readonly source: TelemetryInputFieldSource;
}

/**
 * The structural metadata attached to a {@link Telemetry.Schema} class — its
 * scope, declared fields, and per-field source classification. Consumed by the
 * runtime (materialize) and by wiring (`PlainFields` extraction).
 *
 * @internal
 */
export interface TelemetrySchemaDefinition {
  readonly [TelemetrySchemaTypeId]: typeof TelemetrySchemaTypeId;
  readonly scope: unknown;
  readonly fields: TelemetrySchemaFields;
  readonly inputFields: ReadonlyArray<TelemetryInputField>;
}

/**
 * A `Telemetry.Schema` event-schema class: a `Schema.Class` backed by the
 * **full wire payload** (every field normalized to regular `Schema.*`).
 *
 * - {@link Schema.Schema.Type} on the class (`MyEvent.Type`) is the decoded wire
 *   payload — the shape Store RPC, archive decode, and telemetry transport use.
 * - {@link TelemetrySchemaClass.Struct} is the same shape as a `Schema.Struct`
 *   value for `Schema.decode`, `Procedure.success`, etc.
 * - Author-time `fields` retain scope selectors and terminals for wiring
 *   materialize; {@link PlainFields} (internal) derives bind keys from them.
 *
 * @public
 */
export type TelemetrySchemaClass<
  Fields extends TelemetrySchemaFields = TelemetrySchemaFields,
  WireFields extends Schema.Struct.Fields = Schema.Struct.Fields,
> = TelemetrySchemaDefinition & {
  readonly fields: Fields;
  readonly Struct: Schema.Struct<WireFields>;
  readonly Type: Schema.Schema.Type<Schema.Struct<WireFields>>;
};

/**
 * Plain `Schema.*` leaves on a telemetry schema that require wiring `bind`.
 * Internal to wiring exhaustiveness — not the public wire payload type.
 * Full type-level computation lands in Step 3 (`WiringConfig`).
 *
 * @internal
 */
export type PlainFields<_Fields extends TelemetrySchemaFields> = Record<never, never>;

const getTerminal = (value: unknown): TelemetryTerminal | undefined =>
  isRecord(value) && TELEMETRY_TERMINAL_KEY in value
    ? (value as TelemetryTerminal)
    : undefined;

const getInput = (value: unknown): TelemetryInput | undefined =>
  isRecord(value) && TELEMETRY_INPUT_KEY in value
    ? (value as TelemetryInput)
    : undefined;

const getLiteral = (value: unknown): boolean => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (!isRecord(value) || !isRecord(value["ast"])) {
    return false;
  }
  return value["ast"]["_tag"] === "Literal";
};

const isSchemaLike = (value: unknown): value is Schema.Top =>
  isRecord(value) && "ast" in value;

/** @internal */
export const isTelemetrySchemaDefinition = (
  value: unknown,
): value is TelemetrySchemaDefinition =>
  (typeof value === "object" || typeof value === "function") &&
  value !== null &&
  TelemetrySchemaTypeId in value &&
  (value as TelemetrySchemaDefinition)[TelemetrySchemaTypeId] ===
    TelemetrySchemaTypeId;

const terminalClockMillis: Schema.Number & TelemetryTerminal = Object.assign(
  Schema.Number.annotate({}),
  { [TELEMETRY_TERMINAL_KEY]: "clockMillis" as const },
);

const terminalDurationMs: Schema.Number & TelemetryTerminal = Object.assign(
  Schema.Number.annotate({}),
  { [TELEMETRY_TERMINAL_KEY]: "durationMs" as const },
);

const inputErrorString: Schema.String & TelemetryInput = Object.assign(
  Schema.String.annotate({}),
  { [TELEMETRY_INPUT_KEY]: "errorString" as const },
);

const materializedField = (
  value: TelemetrySchemaField,
  visiting: Set<object>,
): Schema.Top => {
  if (isTelemetrySchemaDefinition(value)) {
    if (visiting.has(value)) {
      throw new Error("Telemetry.Schema cycle detected in nested schema fields");
    }
    visiting.add(value);
    const nested = materializedFields(value.fields, visiting);
    visiting.delete(value);
    return Schema.Struct(nested);
  }
  if (getStateFieldSelectorMetadata(value) !== undefined) {
    return value as Schema.Top;
  }
  const terminal = getTerminal(value);
  if (terminal !== undefined) {
    return Schema.Number;
  }
  const input = getInput(value);
  if (input !== undefined) {
    return Schema.String;
  }
  if (value === null) {
    return Schema.Null;
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return Schema.Literal(value);
  }
  if (isSchemaLike(value)) {
    return value;
  }
  throw new Error("Telemetry.Schema field has no materialized schema mapping");
};

const materializedFields = (
  fields: TelemetrySchemaFields,
  visiting: Set<object> = new Set(),
): Schema.Struct.Fields => {
  const out: Record<string, Schema.Top> = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = materializedField(value, visiting);
  }
  return out;
};

const telemetrySchema =
  <Self extends object>() =>
  <Scope>(scope: Scope) =>
  <const Fields extends TelemetrySchemaFields>(
    fields: Fields,
  ) => {
    const wireFields = materializedFields(fields);
    const Struct = Schema.Struct(wireFields);
    const Base = Schema.Class<Self>("Telemetry.Schema")(wireFields);
    const inputFields: Array<TelemetryInputField> = [];
    for (const [field, value] of Object.entries(fields)) {
      const input = getInput(value);
      if (input !== undefined) {
        inputFields.push({ field, source: input[TELEMETRY_INPUT_KEY] });
        continue;
      }
      if (
        getStateFieldSelectorMetadata(value) === undefined &&
        getTerminal(value) === undefined &&
        !getLiteral(value) &&
        isSchemaLike(value)
      ) {
        inputFields.push({ field, source: "field" });
      }
    }
    const definition = {
      [TelemetrySchemaTypeId]: TelemetrySchemaTypeId,
      scope,
      fields,
      inputFields,
    } satisfies TelemetrySchemaDefinition;
    return Object.assign(Base, definition, { Struct }) as unknown as typeof Base &
      Omit<TelemetrySchemaDefinition, "scope" | "fields"> & {
        readonly scope: Scope;
        readonly fields: Fields;
        readonly Struct: typeof Struct;
      };
  };

// ============================================================================
// Tree builder parts (API 1 skeleton)
// ============================================================================

/** @internal */
export interface NamespaceDef<Name extends string> {
  readonly _tag: "namespace";
  readonly namespace: Name;
}

/** @internal */
export interface EventDef<Name extends string, S> {
  readonly _tag: "event";
  readonly name: Name;
  readonly schema: S;
}

/** @internal */
export interface StartDef<Name extends string, S> {
  readonly _tag: "start";
  readonly name: Name;
  readonly schema: S;
}

/** Exit legs keyed by `Exit` outcome. @internal */
export interface ExitLegs {
  readonly onSuccess?: EventDef<string, unknown>;
  readonly onFailure?: EventDef<string, unknown>;
  readonly onInterrupt?: EventDef<string, unknown>;
}

/** @internal */
export interface ExitDef<Legs extends ExitLegs> {
  readonly _tag: "exit";
  readonly legs: Legs;
}

/** A leg of an operation: a start, a middle event, an exit, or a nested op. @internal */
export type OperationPart =
  | StartDef<string, unknown>
  | EventDef<string, unknown>
  | ExitDef<ExitLegs>
  | OperationDef<string, unknown, ReadonlyArray<OperationPart>>;

/** @internal */
export interface OperationDef<
  Name extends string,
  Scope,
  Parts extends ReadonlyArray<OperationPart>,
> {
  readonly _tag: "operation";
  readonly name: Name;
  readonly scope: Scope;
  readonly parts: Parts;
}

/** A child of a group: an event or an operation. @internal */
export type GroupChild =
  | EventDef<string, unknown>
  | OperationDef<string, unknown, ReadonlyArray<OperationPart>>;

/** @internal */
export interface GroupDef<
  Name extends string,
  Children extends ReadonlyArray<GroupChild>,
> {
  readonly _tag: "group";
  readonly name: Name;
  readonly children: Children;
}

const namespace = <const Name extends string>(
  name: Name,
): NamespaceDef<Name> => ({ _tag: "namespace", namespace: name });

const event = <const Name extends string, S>(
  name: Name,
  schema: S,
): EventDef<Name, S> => ({ _tag: "event", name, schema });

const start = <const Name extends string, S>(
  name: Name,
  schema: S,
): StartDef<Name, S> => ({ _tag: "start", name, schema });

const exit = <const Legs extends ExitLegs>(legs: Legs): ExitDef<Legs> => ({
  _tag: "exit",
  legs,
});

const operation =
  <const Name extends string>(name: Name) =>
  <Scope, const Parts extends ReadonlyArray<OperationPart>>(
    scope: Scope,
    ...parts: Parts
  ): OperationDef<Name, Scope, Parts> => ({
    _tag: "operation",
    name,
    scope,
    parts,
  });

const group =
  <const Name extends string>(name: Name) =>
  <const Children extends ReadonlyArray<GroupChild>>(
    ...children: Children
  ): GroupDef<Name, Children> => ({ _tag: "group", name, children });

// ============================================================================
// Node handles (G) + Tag class
// ============================================================================

/** @internal */
export const EventNodeTypeId: unique symbol = Symbol.for(
  "@nikscripts/effect-pm/Telemetry/EventNode",
);

/**
 * A generated wiring key for one emitted event. Carries the event schema as a
 * phantom so wiring can derive its `PlainFields`. Runtime holds the wire id and
 * the handle path.
 *
 * @public
 */
export interface EventNode<S> {
  readonly [EventNodeTypeId]: typeof EventNodeTypeId;
  readonly wire: string;
  readonly path: ReadonlyArray<string>;
  readonly schema: S;
}

type UnionToIntersection<U> = (
  U extends unknown ? (k: U) => void : never
) extends (k: infer I) => void
  ? I
  : never;

type ExitHandles<Legs extends ExitLegs> = {
  readonly [K in keyof Legs as Legs[K] extends EventDef<string, unknown>
    ? K
    : never]: Legs[K] extends EventDef<string, infer S> ? EventNode<S> : never;
};

type OperationPartHandle<P> = P extends StartDef<infer Name, infer S>
  ? { readonly [K in Name]: EventNode<S> }
  : P extends ExitDef<infer Legs>
    ? { readonly exit: ExitHandles<Legs> }
    : P extends OperationDef<infer Name, unknown, infer Parts>
      ? { readonly [K in Name]: OperationHandle<Parts> }
      : P extends EventDef<infer Name, infer S>
        ? { readonly [K in Name]: EventNode<S> }
        : never;

type OperationHandle<Parts extends ReadonlyArray<unknown>> = UnionToIntersection<
  OperationPartHandle<Parts[number]>
>;

type GroupChildHandle<C> = C extends OperationDef<infer Name, unknown, infer Parts>
  ? { readonly [K in Name]: OperationHandle<Parts> }
  : C extends EventDef<infer Name, infer S>
    ? { readonly [K in Name]: EventNode<S> }
    : never;

type GroupHandle<G> = G extends GroupDef<infer Name, infer Children>
  ? { readonly [K in Name]: UnionToIntersection<GroupChildHandle<Children[number]>> }
  : never;

type TagHandles<Groups extends ReadonlyArray<unknown>> = UnionToIntersection<
  GroupHandle<Groups[number]>
>;

/**
 * The class produced by {@link Telemetry.Tag} — a skeleton carrying node
 * handles, the wire namespace, the telemetry `facetId`, and the `target`
 * domain service. Extend it: `class X extends Telemetry.Tag<X>(domain)(…)`.
 *
 * @public
 */
export type TelemetryTagClass<
  Self,
  Target,
  Namespace extends string,
  Groups extends ReadonlyArray<unknown>,
> = (new (_: never) => object) &
  TagHandles<Groups> & {
    readonly namespace: Namespace;
    readonly facetId: string;
    readonly target: Target;
    readonly _self?: Self;
  };

const makeEventNode = (
  namespaceName: string,
  groupName: string,
  eventName: string,
  schema: unknown,
  path: ReadonlyArray<string>,
): EventNode<unknown> => ({
  [EventNodeTypeId]: EventNodeTypeId,
  wire: telemetryWireId(namespaceName, [groupName], eventName),
  schema,
  path,
});

const buildOperationHandles = (
  namespaceName: string,
  groupName: string,
  opPath: ReadonlyArray<string>,
  parts: ReadonlyArray<OperationPart>,
): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const part of parts) {
    if (part._tag === "start" || part._tag === "event") {
      out[part.name] = makeEventNode(namespaceName, groupName, part.name, part.schema, [
        ...opPath,
        part.name,
      ]);
    } else if (part._tag === "exit") {
      const legs: Record<string, unknown> = {};
      for (const [outcome, leg] of Object.entries(part.legs)) {
        if (leg !== undefined) {
          legs[outcome] = makeEventNode(namespaceName, groupName, leg.name, leg.schema, [
            ...opPath,
            "exit",
            outcome,
          ]);
        }
      }
      out["exit"] = legs;
    } else if (part._tag === "operation") {
      out[part.name] = buildOperationHandles(
        namespaceName,
        groupName,
        [...opPath, part.name],
        part.parts,
      );
    }
  }
  return out;
};

const buildGroupHandles = (
  namespaceName: string,
  group: GroupDef<string, ReadonlyArray<GroupChild>>,
): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const child of group.children) {
    if (child._tag === "event") {
      out[child.name] = makeEventNode(namespaceName, group.name, child.name, child.schema, [
        group.name,
        child.name,
      ]);
    } else {
      out[child.name] = buildOperationHandles(
        namespaceName,
        group.name,
        [group.name, child.name],
        child.parts,
      );
    }
  }
  return out;
};

const Tag =
  <Self, Domain = unknown>(domain: Domain) =>
  <
    const NS extends NamespaceDef<string>,
    const Groups extends ReadonlyArray<GroupDef<string, ReadonlyArray<GroupChild>>>,
  >(
    facetId: string,
    ns: NS,
    ...groups: Groups
  ): TelemetryTagClass<Self, Domain, NS["namespace"], Groups> => {
    const namespaceName = ns.namespace;
    const statics: Record<string, unknown> = {
      namespace: namespaceName,
      facetId,
      target: domain,
    };
    for (const group of groups) {
      statics[group.name] = buildGroupHandles(namespaceName, group);
    }
    const base = class {};
    return Object.assign(base, statics) as unknown as TelemetryTagClass<
      Self,
      Domain,
      NS["namespace"],
      Groups
    >;
  };

// ============================================================================
// Wiring (API 3) — value layer
//
// 3a: builders + collector + facet layer/withLayer. The `PlainFields`
// exhaustiveness types (`RequiredBindMap` / strict `WiringConfig`) land in 3b;
// here `WiringConfig` is structural and `bind` field maps are loosely typed.
// ============================================================================

/** @internal */
export const FieldSourceTypeId: unique symbol = Symbol.for(
  "@nikscripts/effect-pm/Telemetry/FieldSource",
);

/**
 * Where a wiring `bind` field's value comes from at materialize: telemetry
 * state, operation input, the operation `Exit`, or the clock.
 *
 * @public
 */
export type FieldSource =
  | { readonly [FieldSourceTypeId]: typeof FieldSourceTypeId; readonly kind: "state"; readonly read: (state: Readonly<Record<string, unknown>>) => unknown }
  | { readonly [FieldSourceTypeId]: typeof FieldSourceTypeId; readonly kind: "input"; readonly key: string }
  | { readonly [FieldSourceTypeId]: typeof FieldSourceTypeId; readonly kind: "exit"; readonly exit: "value" | "cause" | "durationMs" }
  | { readonly [FieldSourceTypeId]: typeof FieldSourceTypeId; readonly kind: "clock" };

/** A `bind` field map: each leaf is a {@link FieldSource}, nested like the schema. @public */
export interface BindFieldMap {
  readonly [key: string]: FieldSource | BindFieldMap;
}

const stateFrom = (
  read: (state: Readonly<Record<string, unknown>>) => unknown,
): FieldSource => ({
  [FieldSourceTypeId]: FieldSourceTypeId,
  kind: "state",
  read,
});

const operationInput = (key: string): FieldSource => ({
  [FieldSourceTypeId]: FieldSourceTypeId,
  kind: "input",
  key,
});

const exitValue: FieldSource = { [FieldSourceTypeId]: FieldSourceTypeId, kind: "exit", exit: "value" };
const exitCause: FieldSource = { [FieldSourceTypeId]: FieldSourceTypeId, kind: "exit", exit: "cause" };
const exitDurationMs: FieldSource = { [FieldSourceTypeId]: FieldSourceTypeId, kind: "exit", exit: "durationMs" };
const clockNow: FieldSource = { [FieldSourceTypeId]: FieldSourceTypeId, kind: "clock" };

/** Telemetry-state metric kind (v1). @public */
export type Metric =
  | { readonly kind: "gauge" }
  | { readonly kind: "counter" }
  | { readonly kind: "timestamp" }
  | { readonly kind: "duration"; readonly from: string; readonly to: string };

const metric = {
  gauge: { kind: "gauge" } as Metric,
  counter: { kind: "counter" } as Metric,
  timestamp: { kind: "timestamp" } as Metric,
  duration: (from: string, to: string): Metric => ({ kind: "duration", from, to }),
} as const;

/** Hidden telemetry-state fields added to a scope. @public */
export interface ExtendSection {
  readonly _section: "extend";
  readonly scopeId: string;
  readonly metrics: Readonly<Record<string, Metric>>;
}

const extend = (
  scope: { readonly id: string },
  metrics: Readonly<Record<string, Metric>>,
): ExtendSection => ({ _section: "extend", scopeId: scope.id, metrics });

/** A log leg attached to a `bind` via `.pipe`. @public */
export interface LogLeg {
  readonly kind: "warning" | "info" | "error";
  readonly message: string;
  readonly annotate?: (event: Readonly<Record<string, unknown>>) => Readonly<Record<string, unknown>>;
}

type BindLeg = (section: BindSection) => BindSection;

/** A wiring `bind` for one event node, with optional log legs. @public */
export interface BindSection {
  readonly _section: "bind";
  readonly path: string;
  readonly wire: string;
  readonly fields: BindFieldMap;
  readonly logs: ReadonlyArray<LogLeg>;
  readonly pipe: (...legs: ReadonlyArray<BindLeg>) => BindSection;
}

const makeBind = (
  path: string,
  wire: string,
  fields: BindFieldMap,
  logs: ReadonlyArray<LogLeg>,
): BindSection => ({
  _section: "bind",
  path,
  wire,
  fields,
  logs,
  pipe(...legs) {
    return legs.reduce<BindSection>((acc, leg) => leg(acc), this);
  },
});

const bind = (handle: EventNode<unknown>, fields: BindFieldMap): BindSection =>
  makeBind(handle.path.join("."), handle.wire, fields, []);

const logLeg =
  (kind: LogLeg["kind"]) =>
  (
    message: string,
    annotate?: LogLeg["annotate"],
  ): BindLeg =>
  (section) =>
    makeBind(section.path, section.wire, section.fields, [
      ...section.logs,
      annotate === undefined ? { kind, message } : { kind, message, annotate },
    ]);

/** A wiring section: telemetry-state `extend` or an event `bind`. @public */
export type WiringSection = ExtendSection | BindSection;

/**
 * Validated facet wiring — `extend` telemetry-state declarations plus event
 * `bind`s (keyed by node path) and their log legs. 3b tightens `binds` to
 * `RequiredBindMap<Tag>` for exhaustiveness.
 *
 * @public
 */
export interface WiringConfig<_Tag = unknown> {
  readonly extend: ReadonlyArray<ExtendSection>;
  readonly binds: Readonly<Record<string, BindSection>>;
  readonly logs: ReadonlyArray<{ readonly path: string; readonly legs: ReadonlyArray<LogLeg> }>;
}

const sections = (...parts: ReadonlyArray<WiringSection>): WiringConfig => {
  const extendSections: Array<ExtendSection> = [];
  const binds: Record<string, BindSection> = {};
  const logs: Array<{ readonly path: string; readonly legs: ReadonlyArray<LogLeg> }> = [];
  for (const part of parts) {
    if (part._section === "extend") {
      extendSections.push(part);
    } else {
      binds[part.path] = part;
      if (part.logs.length > 0) {
        logs.push({ path: part.path, legs: part.logs });
      }
    }
  }
  return { extend: extendSections, binds, logs };
};

/** Facet wiring collector. @public */
export const Wiring = { sections } as const;

/**
 * Build the facet runtime `Layer` from a Tag + wiring. **3a stub** — a no-op
 * layer requiring {@link TelemetryRouter}; the materialize/runner/state runtime
 * lands in Steps 5–6 (`src/internal/telemetry/`).
 *
 * @public
 */
const layer = (
  _tag: unknown,
  _wiring: WiringConfig,
): Layer.Layer<never, never, TelemetryRouter> =>
  Layer.effectDiscard(TelemetryRouter);

/**
 * Facet export: the Tag's calling surface plus a `.layer`. **3a stub** —
 * attaches the layer; the calling API (operation builders) lands in Step 4.
 *
 * @public
 */
const withLayer = <Tag>(
  tag: Tag,
  facetLayer: Layer.Layer<never, never, TelemetryRouter>,
): Tag & { readonly layer: Layer.Layer<never, never, TelemetryRouter> } =>
  Object.assign(tag as object, { layer: facetLayer }) as Tag & {
    readonly layer: Layer.Layer<never, never, TelemetryRouter>;
  };

// ============================================================================
// Public DSL
// ============================================================================

/**
 * Telemetry DSL — event schemas and tree builders.
 *
 * @public
 */
export const Telemetry = {
  Schema: Object.assign(telemetrySchema, {
    TypeId: TelemetrySchemaTypeId,
    is: isTelemetrySchemaDefinition,
  }),
  terminal: {
    clockMillis: terminalClockMillis,
    durationMs: terminalDurationMs,
  },
  input: {
    errorString: inputErrorString,
  },
  Tag,
  namespace,
  group,
  operation,
  start,
  exit,
  event,
  // Wiring (API 3)
  extend,
  bind,
  metric,
  state: { from: stateFrom },
  source: {
    input: operationInput,
    exit: { value: exitValue, cause: exitCause, durationMs: exitDurationMs },
    clock: clockNow,
  },
  logWarning: logLeg("warning"),
  logInfo: logLeg("info"),
  logError: logLeg("error"),
  layer,
  withLayer,
} as const;
