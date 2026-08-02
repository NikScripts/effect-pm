import { Effect, Schema } from "effect";
import * as Gate from "../src/Gate";
import { gateSpec } from "../src/internal/gateSchema";
import * as Hyperlink from "../src/Hyperlink";

// ── The soundness guard for the ONE cast in `nameRunService` ─────────────────
// `yield* MyRun` is asserted to be `Gate<Decoded<I>, A["Type"], WireRunErrorOf<E>>`;
// that assertion is only sound if the named handle is bidirectionally equal to the raw
// contract `ServiceOf<GateInstanceSpec<I, A, E>>`. TS can't prove that for generic params
// (invariant service Shape), so we prove it here for concrete representative schemas. If the
// shapes ever drift, THIS FAILS THE BUILD — which is what licenses the cast.
//
// Wire `run` always includes engine errors: GateStopped | RateLimiterError
// (Never → that union alone; else Union(declared, …)).

type EngineRunError = Gate.GateStopped | Gate.RateLimiterError;

// ── param gate with a typed error: bidirectional Contract ⇄ Handle ───────────
type ContractIE = Hyperlink.ShapeOf<
  ReturnType<typeof gateSpec<typeof Schema.Number, typeof Schema.String, typeof Schema.Boolean>>
>;
type HandleIE = Gate.Gate<number, string, boolean | EngineRunError>;

declare const contractIE: ContractIE;
declare const handleIE: HandleIE;

// bidirectional — direct assignments, no casts. Either failing = the assertion is unsound.
const _handleToContractIE: ContractIE = handleIE;
const _contractToHandleIE: HandleIE = contractIE;
void [_handleToContractIE, _contractToHandleIE];

// ── unit gate (void payload → `run` is a bare Effect): bidirectional ─────────
type ContractUnit = Hyperlink.ShapeOf<
  ReturnType<typeof gateSpec<typeof Schema.Void, typeof Schema.Number>>
>;
type HandleUnit = Gate.Gate<void, number, EngineRunError>;
declare const contractUnit: ContractUnit;
declare const handleUnit: HandleUnit;
const _handleToContractUnit: ContractUnit = handleUnit;
const _contractToHandleUnit: HandleUnit = contractUnit;
void [_handleToContractUnit, _contractToHandleUnit];

// ── the naming actually took effect: `yield* MyRun` (= Shape<MyRun>) IS the named handle ─────────────
class Fetch extends Gate.Tag<Fetch>()("test/run-handle/Fetch", {
  payload: Schema.Number,
  success: Schema.String,
  error: Schema.Boolean,
}) {}
declare const fetchService: Hyperlink.Shape<typeof Fetch>;
const _yieldToHandle: HandleIE = fetchService;
const _handleToYield: Hyperlink.Shape<typeof Fetch> = handleIE;
void [_yieldToHandle, _handleToYield];

// ── DoD: hover exactness. Declared `error: Boolean` wires as `boolean | engine`.
type Exact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const assertExact = <_ extends true>(): void => {};
assertExact<
  Exact<
    Hyperlink.Shape<typeof Fetch>,
    Gate.Gate<number, string, boolean | EngineRunError, never>
  >
>();

// ── DoD: unit gate declaring only `success` → `Gate<void, number, EngineRunError, never>` ────
class Tick extends Gate.Service<Tick>()("test/run-handle/Tick", {
  success: Schema.Number,
  effect: () => Effect.succeed(1),
}) {}
assertExact<
  Exact<
    Hyperlink.Shape<typeof Tick>,
    Gate.Gate<void, number, EngineRunError, never>
  >
>();

// ── DoD: Tag/Service `run` typechecks catchTag for both engine errors ────
declare const tick: Hyperlink.Shape<typeof Tick>;
const _catchStopped = tick.run.pipe(
  Effect.catchTag("GateStopped", () => Effect.succeed(0)),
);
void _catchStopped;
const _catchRateLimit = tick.run.pipe(
  Effect.catchTag("RateLimiterError", () => Effect.succeed(0)),
);
void _catchRateLimit;
const _staticCatch = Tick.run.pipe(
  Effect.catchTag("GateStopped", () => Effect.succeed(0)),
  Effect.catchTag("RateLimiterError", () => Effect.succeed(0)),
);
void _staticCatch;

// ── DoD: metrics nest is on the named Gate handle (R2) ───────────────────────
declare const tickHandle: Hyperlink.Shape<typeof Tick>;
const _metricsRemaining: Hyperlink.Subscribable<number> =
  tickHandle.metrics.remaining;
const _metricsResetAfter: Hyperlink.Subscribable<number> =
  tickHandle.metrics.resetAfter;
const _metricsExceeded: Hyperlink.Subscribable<number> =
  tickHandle.metrics.exceeded;
void [_metricsRemaining, _metricsResetAfter, _metricsExceeded];

// ── DoD: the static `.run` shortcut is Effect (unit) vs a call (parameterized) ───────────────────────
// (mirrors gate.test-d.ts; ensures the naming cast keeps the static run's shape.)
// @ts-expect-error — void gates reject positional input
void Tick.run(1);
// @ts-expect-error — parameterized gates require input
void Fetch.run();
