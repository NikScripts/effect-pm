/**
 * Telemetry section builder for {@link ProcessStore}.
 *
 * @internal
 */

import { Clock, DateTime, Effect, Schema } from "effect";
import type { JsonValue, ProcessStoreWriteError } from "../../ProcessStoreEvent";
import type { RuntimeRecord } from "../../RuntimeStorage";
import {
  getStateFieldSelectorMetadata,
  type StateFieldSelector,
  type StateFieldSelectorMetadata,
} from "../../State";
import type { ProcessStoreSpine } from "./spine";

const TELEMETRY_TAG = "ProcessStore/telemetry" as const;

export const TelemetrySchemaTypeId = Symbol.for(
  "@nikscripts/effect-pm/TelemetrySchema",
);

const TELEMETRY_TERMINAL_KEY = "@nikscripts/effect-pm/TelemetryTerminal" as const;
const TELEMETRY_INPUT_KEY = "@nikscripts/effect-pm/TelemetryInput" as const;

/** Scope-bound facet row schema (plan 17 §5). @internal */
export interface TelemetrySchemaDefinition {
  readonly [TelemetrySchemaTypeId]: typeof TelemetrySchemaTypeId;
  readonly scope: Effect.Effect<unknown, never, unknown>;
  readonly fields: TelemetrySchemaFields;
  readonly inputFields: ReadonlyArray<TelemetryInputField>;
}

type TelemetryTerminal = {
  readonly [TELEMETRY_TERMINAL_KEY]: "clockMillis" | "durationMs";
};

type TelemetryTerminalSchema = Schema.Top & TelemetryTerminal;

type TelemetryInput = {
  readonly [TELEMETRY_INPUT_KEY]: "errorString";
};

type TelemetryInputSchema = Schema.Top & TelemetryInput;

type TelemetrySchemaField = Schema.Top | JsonValue;

type TelemetrySchemaFields = Readonly<Record<string, TelemetrySchemaField>>;

type TelemetryInputField = {
  readonly field: string;
  readonly source: TelemetryInput[typeof TELEMETRY_INPUT_KEY] | "field";
};

type TelemetryLogAnnotationValue = string | number | boolean;

type TelemetryLogAnnotations =
  Readonly<Record<string, TelemetryLogAnnotationValue>>;

type TelemetryLogWarning = {
  readonly message:
    | string
    | ((event: Readonly<Record<string, JsonValue>>) => string);
  readonly annotations?:
    | TelemetryLogAnnotations
    | ((event: Readonly<Record<string, JsonValue>>) => TelemetryLogAnnotations);
};

type TelemetryIdentity = {
  readonly kind: string;
  readonly id?: string;
  readonly processIdSelector?: StateFieldSelectorMetadata;
};

const telemetryIdentityFieldByKind: Readonly<Record<string, string>> = {
  process: "processId",
  "run-resource": "resourceId",
  "queue-resource": "queueId",
};

const telemetryIdentity = (value: unknown): TelemetryIdentity | undefined => {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return undefined;
  }
  const record = value as Readonly<Record<string, unknown>>;
  const kind = record["kind"];
  if (typeof kind !== "string") {
    return undefined;
  }
  const id = record["id"];
  if (typeof id === "string") {
    return { kind, id };
  }
  const schema = record["Schema"];
  if (!isRecord(schema) || !isRecord(schema["State"])) {
    return { kind };
  }
  const field = telemetryIdentityFieldByKind[kind];
  if (field === undefined) {
    return { kind };
  }
  return {
    kind,
    processIdSelector: getStateFieldSelectorMetadata(schema["State"][field]),
  };
};

/** @internal */
export const isTelemetrySchemaDefinition = (
  value: unknown,
): value is TelemetrySchemaDefinition =>
  (typeof value === "object" || typeof value === "function") &&
  value !== null &&
  TelemetrySchemaTypeId in value &&
  (value as TelemetrySchemaDefinition)[TelemetrySchemaTypeId] ===
    TelemetrySchemaTypeId;

export type TelemetryEmitEffect = Effect.Effect<void, ProcessStoreWriteError>;

export type TelemetryEventStoreLeg = (
  s: ProcessStoreSpine,
) => TelemetryEmitEffect;

export type TelemetryEventPipeLeg = <Name extends string, EmitApi>(
  event: TelemetryEventDef<Name, EmitApi>,
) => TelemetryEventDef<Name, EmitApi>;

export type TelemetryEventDef<
  Name extends string = string,
  EmitApi = TelemetryEmitEffect,
> = {
  readonly _tag: "event";
  readonly name: Name;
  readonly store: TelemetryEventStoreLeg;
  readonly telemetrySchema?: TelemetrySchemaDefinition;
  readonly logWarnings: ReadonlyArray<TelemetryLogWarning>;
  readonly pipes: ReadonlyArray<TelemetryEventPipeLeg>;
  readonly _emit?: EmitApi;
};

export type TelemetryTagDef<
  Path extends ReadonlyArray<string> = ReadonlyArray<string>,
  Events extends ReadonlyArray<unknown> = ReadonlyArray<unknown>,
> = {
  readonly _tag: "tag";
  readonly path: Path;
  readonly events: Events;
};

export type TelemetryNamespaceDef = {
  readonly _tag: "namespace";
  readonly namespace: string;
};

export type TelemetryPart =
  | TelemetryNamespaceDef
  | TelemetryTagDef<ReadonlyArray<string>, ReadonlyArray<unknown>>;

export type TelemetryNestedEmitApi = Record<string, unknown>;

export type TelemetryEmitPath = {
  readonly path: ReadonlyArray<string>;
  readonly input: boolean;
};

type UnionToIntersection<Union> =
  (Union extends unknown ? (value: Union) => void : never) extends
    (value: infer Intersection) => void
    ? Intersection
    : never;

type PathEmitApi<Path extends ReadonlyArray<string>, Leaf> =
  Path extends readonly [
    infer Head extends string,
    ...infer Tail extends ReadonlyArray<string>,
  ]
    ? { readonly [K in Head]: PathEmitApi<Tail, Leaf> }
    : Leaf;

type EventEmitApi<Events extends ReadonlyArray<unknown>> = {
  readonly [Event in Events[number] as Event extends
    TelemetryEventDef<infer Name, unknown>
    ? Name
    : never]: Event extends TelemetryEventDef<string, infer EmitApi>
    ? EmitApi
    : never;
};

type TagEmitApi<Tag> = Tag extends TelemetryTagDef<infer Path, infer Events>
  ? PathEmitApi<Path, EventEmitApi<Events>>
  : never;

export type TelemetryEmitApiFromParts<
  Parts extends ReadonlyArray<TelemetryPart>,
> = [Extract<Parts[number], TelemetryTagDef>] extends [never]
  ? Record<never, never>
  : UnionToIntersection<TagEmitApi<Extract<Parts[number], TelemetryTagDef>>> extends
      infer EmitApi
    ? EmitApi extends object
      ? EmitApi
      : Record<never, never>
    : Record<never, never>;

export type TelemetryEventBuilder<
  Name extends string = string,
  EmitApi = TelemetryEmitEffect,
> =
  TelemetryEventDef<Name, EmitApi> & {
  readonly pipe: (
    leg: TelemetryEventPipeLeg,
  ) => TelemetryEventBuilder<Name, EmitApi>;
};

const isEventDef = (value: unknown): value is TelemetryEventDef =>
  typeof value === "object" &&
  value !== null &&
  (value as TelemetryEventDef)._tag === "event";

const joinWire = (segments: ReadonlyArray<string>): string =>
  segments.join(".");

export const telemetryWireId = (
  namespace: string,
  tagPath: ReadonlyArray<string>,
  eventName: string,
): string => joinWire([namespace, ...tagPath, eventName]);

const makeEventBuilder = <Name extends string, EmitApi>(
  event: TelemetryEventDef<Name, EmitApi>,
): TelemetryEventBuilder<Name, EmitApi> => ({
  ...event,
  pipe: (leg) =>
    makeEventBuilder(leg(event)),
});

let telemetrySequence = 0;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toJsonValue = (value: unknown): JsonValue => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(toJsonValue);
  }
  if (isRecord(value)) {
    const out: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = toJsonValue(entry);
    }
    return out;
  }
  return String(value);
};

const readPath = (
  value: unknown,
  path: ReadonlyArray<string>,
): unknown => {
  let current = value;
  for (const segment of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
};

const getTerminal = (value: unknown): TelemetryTerminal | undefined =>
  isRecord(value) && TELEMETRY_TERMINAL_KEY in value
    ? (value as TelemetryTerminal)
    : undefined;

const getInput = (value: unknown): TelemetryInput | undefined =>
  isRecord(value) && TELEMETRY_INPUT_KEY in value
    ? (value as TelemetryInput)
    : undefined;

const getLiteral = (value: unknown): JsonValue | undefined => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (!isRecord(value) || !isRecord(value["ast"])) {
    return undefined;
  }
  const ast = value["ast"];
  if (ast["_tag"] !== "Literal") {
    return undefined;
  }
  const literal = ast["literal"];
  return literal === undefined ? undefined : toJsonValue(literal);
};

const isSchemaLike = (value: unknown): value is Schema.Top =>
  isRecord(value) && "ast" in value;

const materializeField = (
  key: string,
  state: unknown,
  field: unknown,
  input: unknown,
  current: Readonly<Record<string, JsonValue>>,
): Effect.Effect<JsonValue> => {
  const selector: StateFieldSelectorMetadata | undefined =
    getStateFieldSelectorMetadata(field);
  if (selector !== undefined) {
    const value = readPath(state, selector.path);
    return value === undefined
      ? Effect.die(`Telemetry.Schema scope path missing: ${selector.path.join(".")}`)
      : Effect.succeed(toJsonValue(value));
  }
  const terminal = getTerminal(field);
  if (terminal?.[TELEMETRY_TERMINAL_KEY] === "clockMillis") {
    return Clock.currentTimeMillis.pipe(Effect.map(toJsonValue));
  }
  if (terminal?.[TELEMETRY_TERMINAL_KEY] === "durationMs") {
    const startedAt = current["startedAt"];
    const completedAt = current["completedAt"];
    return typeof startedAt === "number" && typeof completedAt === "number"
      ? Effect.succeed(Math.max(0, completedAt - startedAt))
      : Effect.die("Telemetry.terminal.durationMs requires numeric startedAt and completedAt fields");
  }
  const inputSource = getInput(field);
  if (inputSource?.[TELEMETRY_INPUT_KEY] === "errorString") {
    return input === undefined
      ? Effect.die("Telemetry.input.errorString requires an event input")
      : Effect.succeed(String(input));
  }
  const literal = getLiteral(field);
  if (literal !== undefined) {
    return Effect.succeed(literal);
  }
  if (isSchemaLike(field)) {
    if (!isRecord(input)) {
      return Effect.die(`Telemetry.Schema input field "${key}" requires an event input object`);
    }
    return Effect.sync(() => toJsonValue(field.make(input[key])));
  }
  return Effect.die("Telemetry.Schema field is missing a scope, terminal, or literal source");
};

const schemaFields = (fields: TelemetrySchemaFields): Schema.Struct.Fields => {
  const out: Record<PropertyKey, Schema.Top> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (isSchemaLike(value)) {
      out[key] = value;
    }
  }
  return out;
};

const materializeSchema = (
  schema: TelemetrySchemaDefinition,
  input: unknown,
): Effect.Effect<{
  readonly state: unknown;
  readonly payload: Readonly<Record<string, JsonValue>>;
}> =>
  (schema.scope as Effect.Effect<unknown>).pipe(
    Effect.flatMap((state) =>
      Effect.gen(function* () {
        const out: Record<string, JsonValue> = {};
        for (const [key, field] of Object.entries(schema.fields)) {
          out[key] = yield* materializeField(key, state, field, input, out);
        }
        return { state, payload: out };
      }),
    ),
  );

const stringField = (
  event: Readonly<Record<string, JsonValue>>,
  key: string,
  fallback: string,
): string => {
  const value = event[key];
  return typeof value === "string" ? value : fallback;
};

const makeSchemaRecord = (
  wireId: string,
  event: Readonly<Record<string, JsonValue>>,
  state: unknown,
  identity: TelemetryIdentity | undefined,
): Omit<RuntimeRecord, "runId" | "createdAt"> => {
  telemetrySequence += 1;
  const occurredAt =
    typeof event["occurredAt"] === "number"
      ? event["occurredAt"]
      : typeof event["completedAt"] === "number"
        ? event["completedAt"]
        : 0;
  const scopedProcessId =
    identity?.processIdSelector === undefined
      ? undefined
      : readPath(state, identity.processIdSelector.path);
  return {
    id: `${wireId}-${String(telemetrySequence)}`,
    type: wireId,
    occurredAt: DateTime.makeUnsafe(occurredAt),
    processType: identity?.kind ?? stringField(event, "processType", "telemetry"),
    processId:
      identity?.id ??
      (typeof scopedProcessId === "string" ? scopedProcessId : undefined) ??
      stringField(event, "processId", wireId),
    payload: event,
    ...(typeof event["groupId"] === "string"
      ? { attributes: { groupId: event["groupId"] } }
      : {}),
  };
};

const annotateWarning = (
  effect: Effect.Effect<void>,
  annotations: TelemetryLogAnnotations,
): Effect.Effect<void> =>
  Object.entries(annotations).reduce(
    (acc, [key, value]) => acc.pipe(Effect.annotateLogs(key, value)),
    effect,
  );

const logSchemaWarning = (
  warning: TelemetryLogWarning,
  event: Readonly<Record<string, JsonValue>>,
  error: unknown,
): Effect.Effect<void> => {
  const message =
    typeof warning.message === "function"
      ? warning.message(event)
      : warning.message;
  const annotations =
    typeof warning.annotations === "function"
      ? warning.annotations(event)
      : (warning.annotations ?? {});
  return annotateWarning(Effect.logWarning(message), {
    ...annotations,
    error: String(error),
  });
};

const applySchemaWarnings = (
  effect: Effect.Effect<void, ProcessStoreWriteError>,
  event: TelemetryEventDef,
  payload: Readonly<Record<string, JsonValue>>,
): Effect.Effect<void, ProcessStoreWriteError> => {
  if (event.logWarnings.length === 0) {
    return effect;
  }
  return effect.pipe(
    Effect.catch((error: ProcessStoreWriteError) =>
      Effect.forEach(event.logWarnings, (warning) =>
        logSchemaWarning(warning, payload, error),
      ),
    ),
  );
};

const schemaEventStore = (
  s: ProcessStoreSpine,
  namespace: string,
  tagPath: ReadonlyArray<string>,
  event: TelemetryEventDef,
  identity: TelemetryIdentity | undefined,
  input?: unknown,
): TelemetryEmitEffect => {
  if (event.telemetrySchema === undefined) {
    return event.store(s);
  }
  const wireId = telemetryWireId(namespace, tagPath, event.name);
  return materializeSchema(event.telemetrySchema, input).pipe(
    Effect.flatMap(({ state, payload }) =>
      applySchemaWarnings(
        s.create(makeSchemaRecord(wireId, payload, state, identity)),
        event,
        payload,
      ),
    ),
  );
};

const buildNestedApi = (
  s: ProcessStoreSpine,
  namespace: string,
  tagPath: ReadonlyArray<string>,
  identity: TelemetryIdentity | undefined,
  events: ReadonlyArray<unknown>,
): TelemetryNestedEmitApi => {
  const out: Record<string, unknown> = {};
  for (const event of events as ReadonlyArray<TelemetryEventDef>) {
    out[event.name] =
      event.telemetrySchema !== undefined &&
      event.telemetrySchema.inputFields.length > 0
        ? (input: unknown) => schemaEventStore(s, namespace, tagPath, event, identity, input)
        : schemaEventStore(s, namespace, tagPath, event, identity);
  }
  return out as TelemetryNestedEmitApi;
};

const mergeNestedApis = (
  target: TelemetryNestedEmitApi,
  source: TelemetryNestedEmitApi,
): TelemetryNestedEmitApi => {
  for (const [key, value] of Object.entries(source)) {
    const existing = target[key];
    if (
      existing !== undefined &&
      typeof existing === "object" &&
      typeof value === "object" &&
      !isEventDef(value) &&
      typeof (existing as TelemetryEmitEffect).pipe !== "function"
    ) {
      mergeNestedApis(
        existing as TelemetryNestedEmitApi,
        value as TelemetryNestedEmitApi,
      );
    } else {
      (target as Record<string, unknown>)[key] = value;
    }
  }
  return target;
};

/** @internal */
export interface ProcessStoreTelemetrySection<EmitApi extends object> {
  readonly _tag: typeof TELEMETRY_TAG;
  readonly fn: (s: ProcessStoreSpine) => EmitApi;
  readonly emitTree: TelemetryNestedEmitApi;
  readonly emitPaths: ReadonlyArray<TelemetryEmitPath>;
  readonly wireIds: ReadonlyArray<string>;
}

const makeProcessStoreTelemetry = <const Parts extends ReadonlyArray<TelemetryPart>>(
  identity: TelemetryIdentity | undefined,
  ...parts: Parts
): ProcessStoreTelemetrySection<TelemetryEmitApiFromParts<Parts>> => {
  let namespace = "";
  const emitTree: TelemetryNestedEmitApi = {};

  for (const part of parts) {
    switch (part._tag) {
      case "namespace":
        namespace = part.namespace;
        break;
      case "tag": {
        const api = buildNestedApi({} as ProcessStoreSpine, namespace, part.path, identity, part.events);
        const leaf: Record<string, unknown> = {};
        let node = leaf;
        for (let i = 0; i < part.path.length; i += 1) {
          const segment = part.path[i]!;
          if (i === part.path.length - 1) {
            node[segment] = api;
          } else {
            const next: Record<string, unknown> = {};
            node[segment] = next;
            node = next;
          }
        }
        mergeNestedApis(emitTree, leaf as TelemetryNestedEmitApi);
        break;
      }
    }
  }

  const wireIds: string[] = [];
  const emitPaths: TelemetryEmitPath[] = [];
  const collectWire = (
    tagPath: ReadonlyArray<string>,
    events: ReadonlyArray<unknown>,
  ): void => {
    for (const event of events as ReadonlyArray<TelemetryEventDef>) {
      wireIds.push(telemetryWireId(namespace, tagPath, event.name));
      emitPaths.push({
        path: [...tagPath, event.name],
        input:
          event.telemetrySchema !== undefined &&
          event.telemetrySchema.inputFields.length > 0,
      });
    }
  };

  for (const part of parts) {
    if (part._tag === "tag") {
      collectWire(part.path, part.events);
    }
  }

  const fn = (s: ProcessStoreSpine): TelemetryEmitApiFromParts<Parts> => {
    const out: TelemetryNestedEmitApi = {};
    for (const part of parts) {
      if (part._tag !== "tag") continue;
      const api = buildNestedApi(s, namespace, part.path, identity, part.events);
      const leaf: Record<string, unknown> = {};
      let node = leaf;
      for (let i = 0; i < part.path.length; i += 1) {
        const segment = part.path[i]!;
        if (i === part.path.length - 1) {
          node[segment] = api;
        } else {
          const next: Record<string, unknown> = {};
          node[segment] = next;
          node = next;
        }
      }
      mergeNestedApis(out, leaf as TelemetryNestedEmitApi);
    }
    return out as TelemetryEmitApiFromParts<Parts>;
  };

  return {
    _tag: TELEMETRY_TAG,
    fn,
    emitTree,
    emitPaths,
    wireIds,
  };
};

/** @internal */
export function processStoreTelemetry<const Parts extends ReadonlyArray<TelemetryPart>>(
  ...parts: Parts
): ProcessStoreTelemetrySection<TelemetryEmitApiFromParts<Parts>>;
export function processStoreTelemetry(identity: unknown): <
  const Parts extends ReadonlyArray<TelemetryPart>,
>(
  ...parts: Parts
) => ProcessStoreTelemetrySection<TelemetryEmitApiFromParts<Parts>>;
export function processStoreTelemetry(
  firstOrPart?: unknown,
  ...rest: ReadonlyArray<TelemetryPart>
) {
  const identity = telemetryIdentity(firstOrPart);
  if (identity !== undefined) {
    return <const Parts extends ReadonlyArray<TelemetryPart>>(
      ...parts: Parts
    ) => makeProcessStoreTelemetry(identity, ...parts);
  }
  return makeProcessStoreTelemetry(
    undefined,
    ...(firstOrPart === undefined
      ? rest
      : [firstOrPart as TelemetryPart, ...rest]),
  );
}

function defineTelemetryEvent<const Name extends string, EmitApi>(
  name: Name,
  input: TelemetrySchemaClass<EmitApi>,
): TelemetryEventBuilder<Name, EmitApi>;
function defineTelemetryEvent<const Name extends string>(
  name: Name,
  input: { readonly store: TelemetryEventStoreLeg },
): TelemetryEventBuilder<Name, TelemetryEmitEffect>;
function defineTelemetryEvent<const Name extends string>(
  name: Name,
  input: TelemetrySchemaClass<unknown> | { readonly store: TelemetryEventStoreLeg },
): TelemetryEventBuilder<Name, unknown> {
  if (isTelemetrySchemaDefinition(input)) {
    return makeEventBuilder({
      _tag: "event",
      name,
      telemetrySchema: input,
      logWarnings: [],
      pipes: [],
      store: () =>
        Effect.die(
          "Telemetry.Schema emit is not implemented yet (see docs/plans/17-facet-telemetry-factory.md)",
        ),
    });
  }
  return makeEventBuilder({
    _tag: "event",
    name,
    store: input.store,
    logWarnings: [],
    pipes: [],
  });
}

/** Identity pipe leg until annotateLogs is implemented. @internal */
export const telemetryAnnotateLogsPipeLeg: TelemetryEventPipeLeg = (event) => event;

const telemetryLogWarning =
  (
    message: TelemetryLogWarning["message"],
    annotations?: TelemetryLogWarning["annotations"],
  ): TelemetryEventPipeLeg =>
  (event) => ({
    ...event,
    logWarnings: [...event.logWarnings, { message, annotations }],
  });

type InputFieldValue = Schema.Top | TelemetryInputSchema;

type EventInputField<Fields extends TelemetrySchemaFields> = {
  readonly [K in keyof Fields]: Fields[K] extends StateFieldSelector
    ? never
    : Fields[K] extends TelemetryTerminalSchema
      ? never
      : Fields[K] extends JsonValue
        ? never
        : Fields[K] extends InputFieldValue
          ? Fields[K]
          : never;
}[keyof Fields];

type TelemetrySchemaEmitApi<Fields extends TelemetrySchemaFields> =
  [EventInputField<Fields>] extends [never]
    ? Effect.Effect<void>
    : (input: unknown) => Effect.Effect<void>;

type TelemetrySchemaClass<EmitApi = TelemetryEmitEffect> = TelemetrySchemaDefinition & {
  new(_: never): object;
  readonly _telemetryEmit?: EmitApi;
};

const telemetrySchema = <Self extends object>() =>
<Scope extends Effect.Effect<unknown, never, unknown>>(scope: Scope) =>
<const Fields extends TelemetrySchemaFields>(
  fields: Fields,
): TelemetrySchemaClass<TelemetrySchemaEmitApi<Fields>> => {
  const Base = Schema.Class<Self>("Telemetry.Schema")(schemaFields(fields)) as unknown as {
    new(_: never): Self;
  };
  const inputFields: TelemetryInputField[] = [];
  for (const [field, value] of Object.entries(fields)) {
    const input = getInput(value);
    if (input !== undefined) {
      inputFields.push({ field, source: input[TELEMETRY_INPUT_KEY] });
      continue;
    }
    if (
      getStateFieldSelectorMetadata(value) === undefined &&
      getTerminal(value) === undefined &&
      getLiteral(value) === undefined &&
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

const terminalClockMillis = Object.assign(Schema.Number.annotate({}), {
  [TELEMETRY_TERMINAL_KEY]: "clockMillis" as const,
});

const terminalDurationMs = Object.assign(Schema.Number.annotate({}), {
  [TELEMETRY_TERMINAL_KEY]: "durationMs" as const,
});

const inputErrorString = Object.assign(Schema.String.annotate({}), {
  [TELEMETRY_INPUT_KEY]: "errorString" as const,
});

export const Telemetry = {
  namespace: (namespace: string): TelemetryNamespaceDef => ({
    _tag: "namespace",
    namespace,
  }),
  tag:
    <const Path extends ReadonlyArray<string>>(...path: Path) =>
    <const Events extends ReadonlyArray<unknown>>(
      ...events: Events
    ): TelemetryTagDef<Path, Events> => ({
      _tag: "tag",
      path,
      events,
    }),
  event: defineTelemetryEvent,
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
  logWarning: telemetryLogWarning,
  annotateLogs: telemetryAnnotateLogsPipeLeg,
} as const;
