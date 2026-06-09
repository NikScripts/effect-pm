/**
 * Type-level proof of wiring exhaustiveness + per-bind field shape (Step 3b).
 *
 * `RequiredBindMap` — every event node with PlainFields must be bound.
 * `Telemetry.bind` — fields must match schema `_bindFields` (precomputed at
 * schema definition; looked up from handle — Option 1).
 *
 * RunResource `State.Changed` wiring deferred until State.Root — see
 * state-root-telemetry-resume-handoff.md.
 */
import { Schema } from "effect";
import { State } from "../src/State";
import {
  type RequiredBindMap,
  Telemetry,
  type WiringConfig,
  Wiring,
} from "../src/Telemetry";

const DemoScope = State.Scope("@test/demo", "Demo")({
  id: Schema.String,
});

const DemoRunScope = DemoScope.withLeaf("Run", {
  runId: Schema.String,
});

class DemoStarted extends Telemetry.Schema<DemoStarted>()(DemoRunScope)({
  runId: DemoRunScope.Schema.State.Run.runId,
  occurredAt: Telemetry.terminal.clockMillis,
  payload: Schema.Struct({ n: Schema.Number }),
}) {}

class DemoDone extends Telemetry.Schema<DemoDone>()(DemoRunScope)({
  occurredAt: Telemetry.terminal.clockMillis,
  payload: Schema.Struct({ ms: Schema.Number }),
}) {}

const demoTarget = { key: "@test/demo" } as const;

class DemoTelemetry extends Telemetry.Tag<DemoTelemetry>(demoTarget)(
  "@test/demo/Telemetry",
  Telemetry.namespace("Demo"),
  Telemetry.group("Run")(
    Telemetry.operation("run")(
      DemoRunScope,
      Telemetry.start("Started", DemoStarted),
      Telemetry.exit({ onSuccess: Telemetry.event("Done", DemoDone) }),
    ),
  ),
) {}

type DemoWiring = WiringConfig<typeof DemoTelemetry>;

type _BindKeys = keyof typeof DemoStarted._bindFields;
type _ScopeBoundOmittedFromBind = "runId" extends _BindKeys ? false : true;
const _scopeBoundOmitted: _ScopeBoundOmittedFromBind = true;

// ── RequiredBindMap (handle exhaustiveness) ───────────────────────────────────

export const requiredOk: RequiredBindMap<typeof DemoTelemetry> = {
  "Run.run.Started": 0 as unknown,
  "Run.run.exit.onSuccess": 0 as unknown,
};

// @ts-expect-error - "Run.run.exit.onSuccess" is missing.
export const requiredMissing: RequiredBindMap<typeof DemoTelemetry> = {
  "Run.run.Started": 0 as unknown,
};

// ── Wiring.sections + satisfies ─────────────────────────────────────────────

export const complete = Wiring.sections(
  Telemetry.bind(DemoTelemetry.Run.run.Started, {
    payload: { n: Telemetry.source.clock },
  }),
  Telemetry.bind(DemoTelemetry.Run.run.exit.onSuccess, {
    payload: { ms: Telemetry.source.exit.durationMs },
  }),
) satisfies DemoWiring;

const incompleteWiring = Wiring.sections(
  Telemetry.bind(DemoTelemetry.Run.run.Started, {
    payload: { n: Telemetry.source.clock },
  }),
);
// @ts-expect-error - "Run.run.exit.onSuccess" required by RequiredBindMap
export const incomplete: DemoWiring = incompleteWiring;

// ── Per-bind field shape (_bindFields on schema class) ─────────────────────

export const wrongNestedKey = Telemetry.bind(DemoTelemetry.Run.run.Started, {
  // @ts-expect-error - unknown key inside nested payload struct
  payload: { totallyWrong: Telemetry.source.clock },
});

export const missingInner = Telemetry.bind(DemoTelemetry.Run.run.Started, {
  // @ts-expect-error - missing required inner field `n`
  payload: {},
});

export const typoTop = Telemetry.bind(DemoTelemetry.Run.run.Started, {
  // @ts-expect-error - typo at top-level bind key
  paylod: { n: Telemetry.source.clock },
});

// @ts-expect-error - missing required top-level `payload`
export const missingPayload = Telemetry.bind(DemoTelemetry.Run.run.Started, {});

void complete;
void incomplete;
void requiredOk;
void requiredMissing;
void wrongNestedKey;
void missingInner;
void typoTop;
void missingPayload;
void _scopeBoundOmitted;
