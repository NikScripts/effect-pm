/**
 * Telemetry section builder for {@link ProcessStore}.
 *
 * @internal
 */

import { Effect, Schema } from "effect";
import type { ProcessStoreWriteError } from "../../ProcessStoreEvent";
import type { ProcessStoreSpine } from "./spine";

const TELEMETRY_TAG = "ProcessStore/telemetry" as const;

export const TelemetrySchemaTypeId = Symbol.for(
  "@nikscripts/effect-pm/TelemetrySchema",
);

/** Scope-bound facet row schema (plan 17 §5). @internal */
export interface TelemetrySchemaDefinition {
  readonly [TelemetrySchemaTypeId]: typeof TelemetrySchemaTypeId;
  readonly scope: unknown;
  readonly fields: Readonly<Record<string, unknown>>;
}

/** @internal */
export const isTelemetrySchemaDefinition = (
  value: unknown,
): value is TelemetrySchemaDefinition =>
  typeof value === "object" &&
  value !== null &&
  TelemetrySchemaTypeId in value &&
  (value as TelemetrySchemaDefinition)[TelemetrySchemaTypeId] ===
    TelemetrySchemaTypeId;

export type TelemetryEmitEffect = Effect.Effect<void, ProcessStoreWriteError>;

export type TelemetryEventStoreLeg = (
  s: ProcessStoreSpine,
) => TelemetryEmitEffect;

export type TelemetryEventPipeLeg = <Name extends string>(
  event: TelemetryEventDef<Name>,
) => TelemetryEventDef<Name>;

export type TelemetryEventDef<Name extends string = string> = {
  readonly _tag: "event";
  readonly name: Name;
  readonly store: TelemetryEventStoreLeg;
  readonly telemetrySchema?: TelemetrySchemaDefinition;
  readonly pipes: ReadonlyArray<TelemetryEventPipeLeg>;
};

export type TelemetryTagDef<
  Path extends ReadonlyArray<string> = ReadonlyArray<string>,
  Events extends ReadonlyArray<TelemetryEventDef> = ReadonlyArray<TelemetryEventDef>,
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
  | TelemetryTagDef;

export type TelemetryNestedEmitApi = Record<string, unknown>;

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

type EventEmitApi<Events extends ReadonlyArray<TelemetryEventDef>> = {
  readonly [Event in Events[number] as Event["name"]]: TelemetryEmitEffect;
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

export type TelemetryEventInput =
  | TelemetrySchemaDefinition
  | { readonly store: TelemetryEventStoreLeg };

export type TelemetryEventBuilder<Name extends string = string> =
  TelemetryEventDef<Name> & {
  readonly pipe: (
    ...legs: ReadonlyArray<TelemetryEventPipeLeg>
  ) => TelemetryEventBuilder<Name>;
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

const applyEventPipes = <Name extends string>(
  event: TelemetryEventDef<Name>,
  legs: ReadonlyArray<TelemetryEventPipeLeg>,
): TelemetryEventDef<Name> =>
  legs.reduce<TelemetryEventDef<Name>>((current, leg) => leg(current), event);

const makeEventBuilder = <Name extends string>(
  event: TelemetryEventDef<Name>,
): TelemetryEventBuilder<Name> => ({
  ...event,
  pipe: (...legs) =>
    makeEventBuilder(
      applyEventPipes(event, [...event.pipes, ...legs]),
    ),
});

const buildNestedApi = (
  s: ProcessStoreSpine,
  events: ReadonlyArray<TelemetryEventDef>,
): TelemetryNestedEmitApi => {
  const out: Record<string, TelemetryEmitEffect | TelemetryNestedEmitApi> = {};
  for (const event of events) {
    out[event.name] = event.store(s);
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
  readonly wireIds: ReadonlyArray<string>;
}

/** @internal */
export const processStoreTelemetry = <const Parts extends ReadonlyArray<TelemetryPart>>(
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
        const api = buildNestedApi({} as ProcessStoreSpine, part.events);
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
  const collectWire = (
    tagPath: ReadonlyArray<string>,
    events: ReadonlyArray<TelemetryEventDef>,
  ): void => {
    for (const event of events) {
      wireIds.push(telemetryWireId(namespace, tagPath, event.name));
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
      const api = buildNestedApi(s, part.events);
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
    wireIds,
  };
};

const defineTelemetryEvent = <const Name extends string>(
  name: Name,
  input: TelemetryEventInput,
): TelemetryEventBuilder<Name> => {
  if (isTelemetrySchemaDefinition(input)) {
    return makeEventBuilder({
      _tag: "event",
      name,
      telemetrySchema: input,
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
    pipes: [],
  });
};

/** Identity pipe leg until annotateLogs is implemented. @internal */
export const telemetryAnnotateLogsPipeLeg: TelemetryEventPipeLeg = (event) => event;

const telemetrySchemaClass = () => (scope: unknown) =>
(
  fields: Readonly<Record<string, unknown>>,
): TelemetrySchemaDefinition => ({
  [TelemetrySchemaTypeId]: TelemetrySchemaTypeId,
  scope,
  fields,
});

export const Telemetry = {
  namespace: (namespace: string): TelemetryNamespaceDef => ({
    _tag: "namespace",
    namespace,
  }),
  tag:
    <const Path extends ReadonlyArray<string>>(...path: Path) =>
    <const Events extends ReadonlyArray<TelemetryEventBuilder>>(
      ...events: Events
    ): TelemetryTagDef<Path, Events> => ({
      _tag: "tag",
      path,
      events,
    }),
  event: <const Name extends string>(
    name: Name,
    input: TelemetryEventInput,
  ): TelemetryEventBuilder<Name> =>
    defineTelemetryEvent(name, input),
  Schema: {
    TypeId: TelemetrySchemaTypeId,
    is: isTelemetrySchemaDefinition,
    Class: telemetrySchemaClass,
  },
  terminal: {
    clockMillis: Schema.Number,
  },
  annotateLogs: telemetryAnnotateLogsPipeLeg,
} as const;
