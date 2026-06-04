/**
 * Shared hub runtime state for sink registration.
 *
 * @module internal/telemetryHub/state
 * @internal
 */

import { Context, Ref } from "effect";
import type { TelemetrySink } from "../../TelemetryHub";

/** @internal */
export class TelemetryHubState extends Context.Service<
  TelemetryHubState,
  {
    readonly sinksRef: Ref.Ref<ReadonlyArray<TelemetrySink>>;
  }
>()("@nikscripts/effect-pm/internal/telemetryHub/state/TelemetryHubState") {}
