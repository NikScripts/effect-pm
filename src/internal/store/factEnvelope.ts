/**
 * Internal envelope vocabulary used by the spine to carry per-domain facts
 * and state transitions over a single shared {@link RuntimeRecord} row shape.
 *
 * @remarks
 * **Do not import from outside the package.** This module exists so the spine
 * and a small number of facets (currently {@link ProcessStoreQueueResource})
 * can persist arbitrary domain payloads through one wire row without each
 * facet defining its own envelope decoder. Each per-domain facet should
 * publish its own concrete `*Fact` / `*StateChange` types and translate to /
 * from this envelope on read and write.
 *
 * The {@link ProcessStoreRunResource} facet uses its own dedicated event
 * types (`run-resource.fact.recorded` / `run-resource.state.changed`) and
 * does **not** depend on this module.
 *
 * @module internal/store/factEnvelope
 * @internal
 */

import type { AnalyticsEventBase, QueryOpts } from "../../ProcessStoreEvent";

/**
 * Stable identity for a runtime component carried in the shared envelope.
 *
 * @internal
 */
export interface FactEnvelopeRef<out Kind extends string = string> {
  readonly kind: Kind;
  readonly id: string;
}

/**
 * Generic base for a live state snapshot owned by a runtime component.
 *
 * @internal
 */
export interface FactEnvelopeStateBase {
  readonly ref: FactEnvelopeRef;
  readonly observedAt: number;
  readonly configVersion: number;
}

/**
 * Generic state-transition envelope used by the spine codec.
 *
 * @internal
 */
export interface FactEnvelopeStateChange<
  out State extends FactEnvelopeStateBase = FactEnvelopeStateBase,
> {
  readonly id: string;
  readonly ref: FactEnvelopeRef;
  readonly changedAt: number;
  readonly reason: string;
  readonly previous: State | null;
  readonly current: State;
}

/**
 * Generic fact envelope used by facets that do not (yet) have their own
 * dedicated event type. Each per-domain facet should migrate to a concrete
 * event type and stop relying on this envelope.
 *
 * @internal
 */
export interface FactEnvelope<out Payload = unknown> {
  readonly id: string;
  readonly ref: FactEnvelopeRef;
  readonly type: string;
  readonly occurredAt: number;
  readonly payload: Payload;
  readonly attributes?: Record<string, unknown>;
}

/**
 * Stored analytics event wrapping a {@link FactEnvelope}. Wire format
 * `"runtime.fact.recorded"`.
 *
 * @internal
 */
export interface FactEnvelopeRecordedEvent extends AnalyticsEventBase {
  type: "runtime.fact.recorded";
  fact: FactEnvelope;
}

/**
 * Stored analytics event wrapping a {@link FactEnvelopeStateChange}. Wire
 * format `"runtime.state.changed"`.
 *
 * @internal
 */
export interface FactEnvelopeStateChangedEvent extends AnalyticsEventBase {
  type: "runtime.state.changed";
  change: FactEnvelopeStateChange;
}

/**
 * Storage-neutral query for persisted envelope facts.
 *
 * @internal
 */
export interface FactEnvelopeQuery {
  readonly ref?: FactEnvelopeRef;
  readonly types?: ReadonlyArray<FactEnvelope["type"]>;
  readonly opts?: QueryOpts;
}

/**
 * Storage-neutral query for persisted envelope state changes.
 *
 * @internal
 */
export interface FactEnvelopeStateHistoryQuery {
  readonly ref: FactEnvelopeRef;
  readonly opts?: QueryOpts;
}
