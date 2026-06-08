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

import { Schema } from "effect";
import { isRecord } from "./internal/json";
import {
  getStateFieldSelectorMetadata,
} from "./State";
import { telemetryWireId } from "./TelemetryRouter";

// ============================================================================
// Schema definition metadata
// ============================================================================

/** @internal */
export const TelemetrySchemaTypeId = Symbol.for(
  "@nikscripts/effect-pm/Telemetry/Schema",
);

const TELEMETRY_TERMINAL_KEY = "@nikscripts/effect-pm/Telemetry/Terminal" as const;
const TELEMETRY_INPUT_KEY = "@nikscripts/effect-pm/Telemetry/Input" as const;

type TelemetryTerminalKind = "clockMillis" | "durationMs";
type TelemetryInputKind = "errorString";

type TelemetryTerminal = { readonly [TELEMETRY_TERMINAL_KEY]: TelemetryTerminalKind };
type TelemetryInput = { readonly [TELEMETRY_INPUT_KEY]: TelemetryInputKind };

/** A telemetry-schema field: a `Schema.*`, a terminal/input marker, or a literal. */
type TelemetrySchemaField = Schema.Top | TelemetryTerminal | TelemetryInput | string | number | boolean | null;

type TelemetrySchemaFields = Readonly<Record<string, TelemetrySchemaField>>;

/** Classification of how each schema field sources its value at materialize. */
type TelemetryInputFieldSource = TelemetryInputKind | "field";

interface TelemetryInputField {
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
 * A `Telemetry.Schema` event-schema class: a `Schema.Class` carrying
 * {@link TelemetrySchemaDefinition} metadata. Parameterized by its declared
 * `Fields` (used by wiring to derive `PlainFields`). The constructor instance is
 * typed `object` so `class X extends Telemetry.Schema<X>()(…)({…})` does not
 * self-reference.
 *
 * @public
 */
export type TelemetrySchemaClass<
  Fields extends TelemetrySchemaFields = TelemetrySchemaFields,
> = Omit<TelemetrySchemaDefinition, "fields"> & {
  new (_: never): object;
  readonly fields: Fields;
};

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

/** Keep only the `Schema.*` fields — terminals/inputs/literals materialize separately. */
const schemaFields = (fields: TelemetrySchemaFields): Schema.Struct.Fields => {
  const out: Record<PropertyKey, Schema.Top> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (isSchemaLike(value)) {
      out[key] = value;
    }
  }
  return out;
};

const telemetrySchema =
  <Self extends object>() =>
  <Scope>(scope: Scope) =>
  <const Fields extends TelemetrySchemaFields>(
    fields: Fields,
  ): TelemetrySchemaClass<Fields> => {
    const Base = Schema.Class<Self>("Telemetry.Schema")(
      schemaFields(fields),
    ) as unknown as { new (_: never): object };
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
    return Object.assign(Base, definition) as unknown as TelemetrySchemaClass<Fields>;
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
export const EventNodeTypeId = Symbol.for(
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
 * domain service. Extend it: `class X extends Telemetry.Tag<X>()(target)(…)`.
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
  <Self>() =>
  <Target>(target: Target) =>
  <
    const NS extends NamespaceDef<string>,
    const Groups extends ReadonlyArray<GroupDef<string, ReadonlyArray<GroupChild>>>,
  >(
    facetId: string,
    ns: NS,
    ...groups: Groups
  ): TelemetryTagClass<Self, Target, NS["namespace"], Groups> => {
    const namespaceName = ns.namespace;
    const statics: Record<string, unknown> = {
      namespace: namespaceName,
      facetId,
      target,
    };
    for (const group of groups) {
      statics[group.name] = buildGroupHandles(namespaceName, group);
    }
    const base = class {};
    return Object.assign(base, statics) as unknown as TelemetryTagClass<
      Self,
      Target,
      NS["namespace"],
      Groups
    >;
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
} as const;
