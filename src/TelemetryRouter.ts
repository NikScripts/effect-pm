/**
 * **TelemetryRouter** — canonical name for the facet telemetry fan-out router.
 *
 * @remarks
 * The router validates emits and fans out to registered sinks. New telemetry
 * code imports `TelemetryRouter` from here.
 *
 * During migration the implementation still lives in `./TelemetryHub` under the
 * `Context` id `@nikscripts/effect-pm/TelemetryHub`; this module re-exports it
 * so `TelemetryRouter` and the legacy `TelemetryHub` resolve to the **same
 * service instance**. The physical class/file/id rename is the final cleanup
 * step (it changes the `Context` id, so it waits until every importer has moved
 * off `TelemetryHub`). The id↔class-name coupling is enforced by the Effect
 * language-service deterministic-keys rule.
 *
 * @module TelemetryRouter
 */

export * from "./TelemetryHub";
export { TelemetryHub as TelemetryRouter } from "./TelemetryHub";
