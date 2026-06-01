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

export type TelemetryEventPipeLeg = (
  event: TelemetryEventDef,
) => TelemetryEventDef;

export type TelemetryEventDef = {
  readonly _tag: "event";
  readonly name: string;
  readonly store: TelemetryEventStoreLeg;
  readonly telemetrySchema?: TelemetrySchemaDefinition;
  readonly pipes: ReadonlyArray<TelemetryEventPipeLeg>;
};

export type TelemetryTagDef = {
  readonly _tag: "tag";
  readonly path: ReadonlyArray<string>;
  readonly events: ReadonlyArray<TelemetryEventDef>;
};

export type TelemetryNamespaceDef = {
  readonly _tag: "namespace";
  readonly namespace: string;
};

export type TelemetryPart =
  | TelemetryNamespaceDef
  | TelemetryTagDef;

export type TelemetryNestedEmitApi = {
  readonly [key: string]: TelemetryEmitEffect | TelemetryNestedEmitApi;
};

export type TelemetryEventInput =
  | TelemetrySchemaDefinition
  | { readonly store: TelemetryEventStoreLeg };

export type TelemetryEventBuilder = TelemetryEventDef & {
  readonly pipe: (
    ...legs: ReadonlyArray<TelemetryEventPipeLeg>
  ) => TelemetryEventBuilder;
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

const applyEventPipes = (
  event: TelemetryEventDef,
  legs: ReadonlyArray<TelemetryEventPipeLeg>,
): TelemetryEventDef =>
  legs.reduce((current, leg) => leg(current), event);

const makeEventBuilder = (event: TelemetryEventDef): TelemetryEventBuilder => ({
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
export interface ProcessStoreTelemetrySection<EmitApi extends TelemetryNestedEmitApi> {
  readonly _tag: typeof TELEMETRY_TAG;
  readonly fn: (s: ProcessStoreSpine) => EmitApi;
  readonly emitTree: TelemetryNestedEmitApi;
  readonly wireIds: ReadonlyArray<string>;
}

/** @internal */
export const processStoreTelemetry = (
  ...parts: ReadonlyArray<TelemetryPart>
): ProcessStoreTelemetrySection<TelemetryNestedEmitApi> => {
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

  const fn = (s: ProcessStoreSpine): TelemetryNestedEmitApi => {
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
    return out;
  };

  return {
    _tag: TELEMETRY_TAG,
    fn,
    emitTree,
    wireIds,
  };
};

const defineTelemetryEvent = (
  name: string,
  input: TelemetryEventInput,
): TelemetryEventBuilder => {
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
    (...path: ReadonlyArray<string>) =>
    (...events: ReadonlyArray<TelemetryEventBuilder>): TelemetryTagDef => ({
      _tag: "tag",
      path,
      events,
    }),
  event: (name: string, input: TelemetryEventInput): TelemetryEventBuilder =>
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
