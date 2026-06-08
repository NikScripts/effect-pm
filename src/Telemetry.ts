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
 * {@link TelemetrySchemaDefinition} metadata.
 *
 * @public
 */
export type TelemetrySchemaClass<Self = unknown> = TelemetrySchemaDefinition & {
  new (_: never): Self;
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
  ): TelemetrySchemaClass<Self> => {
    const Base = Schema.Class<Self>("Telemetry.Schema")(
      schemaFields(fields),
    ) as unknown as { new (_: never): Self };
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
    return Object.assign(Base, definition);
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
  namespace,
  group,
  operation,
  start,
  exit,
  event,
} as const;
