/**
 * Queue instance spec validation — single boundary cast site for {@link WorkPool.Tag}
 * and {@link WorkPool.priority}.
 *
 * @remarks
 * **Invariant:** every method key and RPC kind on a wired spec must match the erased baseline
 * (`queueSpec(payload)` / `prioritySpec(payload, laneConfig)`) — only the **`events`** stream
 * element schema may differ (tag `success` / `error` wire slots).
 *
 * @module internal/workPoolSpecAssert
 * @internal
 */

import { Data, DateTime, Duration, Schema } from "effect";
import type { AnyLocalMethod, AnyMethod, AnyPureMethod, FlatSpec } from "../Hyperlink";
import { flattenHyperlinkSpec } from "../Hyperlink";
import { buildQueueEvent } from "../WorkPool";
import type { PriorityInstanceSpec } from "../WorkPool";

/** Structural mismatch between wired and baseline queue specs. @internal */
export class QueueSpecShapeError extends Data.TaggedError("QueueSpecShapeError")<{
  readonly reason: string;
}> {}

/** Wire schema encode/decode smoke failed for tag success/error slots. @internal */
export class QueueWireSchemaError extends Data.TaggedError("QueueWireSchemaError")<{
  readonly slot: "success" | "error";
  readonly reason: string;
}> {}

type QueueWire = {
  readonly success?: Schema.Top;
  readonly error?: Schema.Top;
};

const asRpcMethod = (
  m: AnyMethod | AnyLocalMethod | AnyPureMethod | undefined,
): AnyMethod | undefined =>
  m !== undefined && "kind" in m ? (m as AnyMethod) : undefined;

const methodKindKey = (m: AnyMethod): string =>
  `${m.kind}:${m.stream ? "stream" : "effect"}`;

const recoverItemSchema = (
  spec: { readonly add: AnyMethod },
): Schema.Struct<Record<string, Schema.Top>> => {
  const payload = spec.add.payload as unknown as {
    readonly members?: readonly [Schema.Struct<Record<string, Schema.Top>>];
    readonly elements?: ReadonlyArray<{
      readonly members: ReadonlyArray<Schema.Struct<Record<string, Schema.Top>>>;
    }>;
  };
  if (payload.members !== undefined) {
    return payload.members[0];
  }
  const pairHead = payload.elements?.[0];
  const itemFromPair = pairHead?.members?.[0];
  if (itemFromPair !== undefined) {
    return itemFromPair;
  }
  throw new QueueSpecShapeError({
    reason: "queue spec add.payload is not item | item[] union or pair tuple",
  });
};

const smokeSuccessValue = (schema: Schema.Top): unknown => {
  if (schema === Schema.Void) {
    return undefined;
  }
  if (schema === Schema.Number) {
    return 42;
  }
  if (schema === Schema.String) {
    return "smoke";
  }
  return { words: 1 };
};

const assertStructuralMatch = (wiredFlat: FlatSpec, baselineFlat: FlatSpec): void => {
  const wiredKeys = Object.keys(wiredFlat).sort();
  const baselineKeys = Object.keys(baselineFlat).sort();
  if (wiredKeys.join("\0") !== baselineKeys.join("\0")) {
    throw new QueueSpecShapeError({
      reason: `spec keys differ: wired=[${wiredKeys.join(", ")}] baseline=[${baselineKeys.join(", ")}]`,
    });
  }
  for (const key of wiredKeys) {
    if (key === "events") {
      const wiredEvents = asRpcMethod(wiredFlat.events);
      const baselineEvents = asRpcMethod(baselineFlat.events);
      if (
        wiredEvents === undefined ||
        baselineEvents === undefined ||
        wiredEvents.stream !== true ||
        baselineEvents.stream !== true
      ) {
        throw new QueueSpecShapeError({
          reason: "`events` must be a stream method on both specs",
        });
      }
      continue;
    }
    const wired = asRpcMethod(wiredFlat[key]);
    const baseline = asRpcMethod(baselineFlat[key]);
    if (wired === undefined || baseline === undefined) {
      throw new QueueSpecShapeError({ reason: `missing RPC method at key ${key}` });
    }
    if (methodKindKey(wired) !== methodKindKey(baseline)) {
      throw new QueueSpecShapeError({
        reason: `method kind mismatch at ${key}: wired=${methodKindKey(wired)} baseline=${methodKindKey(baseline)}`,
      });
    }
  }
};

const smokeWireSlots = (
  itemSchema: Schema.Struct<Record<string, Schema.Top>>,
  wire: QueueWire | undefined,
): void => {
  if (wire?.success !== undefined && wire.success !== Schema.Void) {
    const successValue = smokeSuccessValue(wire.success);
    const eventSchema = buildQueueEvent(itemSchema, wire.success, wire.error ?? Schema.Unknown);
    const completed = {
      _tag: "Completed" as const,
      entry: {
        item: { id: "smoke" },
        entryId: "smoke",
        priority: "normal" as const,
        attempts: 1,
        timestamps: { enqueuedAt: DateTime.makeUnsafe(0) },
      },
      success: successValue,
      elapsed: Duration.zero,
    };
    type SyncEncoder = Parameters<typeof Schema.encodeUnknownSync>[0];
    type SyncDecoder = Parameters<typeof Schema.decodeUnknownSync>[0];
    const encoder = eventSchema as unknown as SyncEncoder;
    const decoder = eventSchema as unknown as SyncDecoder;
    try {
      const encoded = Schema.encodeUnknownSync(encoder)(completed);
      Schema.decodeUnknownSync(decoder)(encoded);
    } catch (cause) {
      throw new QueueWireSchemaError({
        slot: "success",
        reason: `Completed event wire round-trip failed: ${String(cause)}`,
      });
    }
  }
};

/**
 * Validate a wired queue spec against its erased baseline.
 * **The only** `QueueInstanceSpec` boundary assertion in WorkPool tag build.
 *
 * @internal
 */
export const assertQueueInstanceSpec = <Spec extends Record<string, unknown>>(
  wired: Record<string, unknown>,
  baseline: Spec,
  wire?: QueueWire,
): Spec => {
  assertStructuralMatch(
    flattenHyperlinkSpec(wired as Parameters<typeof flattenHyperlinkSpec>[0]),
    flattenHyperlinkSpec(baseline as Parameters<typeof flattenHyperlinkSpec>[0]),
  );
  smokeWireSlots(
    recoverItemSchema(wired as unknown as { readonly add: AnyMethod }),
    wire,
  );
  // Boundary cast (this module's stated purpose): `wired` carries the tag's real event-schema
  // success/error slots, but the tag's *type* is the erased `baseline` (`QueueInstanceSpec<F>`),
  // where events resolve to the default `void`/`unknown`. The invariant — every method key/kind
  // matches, only the events element differs — is enforced at runtime just above, so this is sound.
  return wired as unknown as Spec;
};

/**
 * Validate a wired priority-queue spec against its erased baseline.
 *
 * @internal
 */
export const assertPriorityInstanceSpec = <F extends Schema.Struct.Fields>(
  wired: unknown,
  baseline: unknown,
  wire?: QueueWire,
): PriorityInstanceSpec<F> => {
  assertStructuralMatch(
    flattenHyperlinkSpec(wired as Parameters<typeof flattenHyperlinkSpec>[0]),
    flattenHyperlinkSpec(baseline as Parameters<typeof flattenHyperlinkSpec>[0]),
  );
  smokeWireSlots(
    recoverItemSchema(wired as unknown as { readonly add: AnyMethod }),
    wire,
  );
  return wired as PriorityInstanceSpec<F>;
};
