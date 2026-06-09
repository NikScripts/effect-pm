/**
 * Type-level proof of wiring **exhaustiveness** (Step 3b, the D3 core): a Tag's
 * wiring must bind every event node whose schema has `PlainFields`, or
 * `satisfies WiringConfig<Tag>` is a compile error.
 *
 * Known v1 limitation: the per-bind *field* shape (`BindFields`) is loose — the
 * handle's schema type widens to `unknown` through the tree builders, so a
 * bind's individual fields aren't yet checked. Exhaustiveness over *handles*
 * (which is what `RequiredBindMap` enforces) is unaffected.
 *
 * The real `RunResourceTelemetry` wiring — incl. `State.Changed` — is deferred
 * until the `State.Root` envelope lands; see state-root-telemetry-resume-handoff.md.
 */
import { Schema } from "effect";
import { State } from "../src/State";
import {
  type RequiredBindMap,
  Telemetry,
  type WiringConfig,
  Wiring,
} from "../src/Telemetry";

class DemoScope extends State.Scope("@test/demo", "Demo")({
  id: Schema.String,
}) {}

class DemoStarted extends Telemetry.Schema<DemoStarted>()(DemoScope)({
  id: DemoScope.Schema.State.id, // scope-bound → auto
  occurredAt: Telemetry.terminal.clockMillis, // terminal → auto
  payload: Schema.Struct({ n: Schema.Number }), // plain → bind required
}) {}

class DemoDone extends Telemetry.Schema<DemoDone>()(DemoScope)({
  occurredAt: Telemetry.terminal.clockMillis,
  payload: Schema.Struct({ ms: Schema.Number }), // plain → bind required
}) {}

const demoTarget = { key: "@test/demo" } as const;

class DemoTelemetry extends Telemetry.Tag<DemoTelemetry>(demoTarget)(
  "@test/demo/Telemetry",
  Telemetry.namespace("Demo"),
  Telemetry.group("Run")(
    Telemetry.operation("run")(
      DemoScope,
      Telemetry.start("Started", DemoStarted),
      Telemetry.exit({ onSuccess: Telemetry.event("Done", DemoDone) }),
    ),
  ),
) {}

type DemoWiring = WiringConfig<typeof DemoTelemetry>;

// ── RequiredBindMap derives the right node-path keys ────────────────────────

// ✅ Both required nodes present.
export const requiredOk: RequiredBindMap<typeof DemoTelemetry> = {
  "Run.run.Started": 0 as unknown,
  "Run.run.exit.onSuccess": 0 as unknown,
};

// @ts-expect-error - "Run.run.exit.onSuccess" is missing.
export const requiredMissing: RequiredBindMap<typeof DemoTelemetry> = {
  "Run.run.Started": 0 as unknown,
};

// ── Exhaustiveness through Wiring.sections + satisfies ──────────────────────

// ✅ Complete wiring — every node with PlainFields is bound.
export const complete = Wiring.sections(
  Telemetry.bind(DemoTelemetry.Run.run.Started, {
    payload: { n: Telemetry.source.clock },
  }),
  Telemetry.bind(DemoTelemetry.Run.run.exit.onSuccess, {
    payload: { ms: Telemetry.source.exit.durationMs },
  }),
) satisfies DemoWiring;

// ❌ Missing the `Run.run.exit.onSuccess` bind → not exhaustive.
const incompleteWiring = Wiring.sections(
  Telemetry.bind(DemoTelemetry.Run.run.Started, {
    payload: { n: Telemetry.source.clock },
  }),
);
// @ts-expect-error - "Run.run.exit.onSuccess" required by RequiredBindMap
export const incomplete: DemoWiring = incompleteWiring;
