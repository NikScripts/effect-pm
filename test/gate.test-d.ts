import { Duration, Effect, Schema } from "effect";
import type { RateLimiter } from "effect/unstable/persistence/RateLimiter";
import * as Gate from "../src/Gate";

class UnitGate extends Gate.Service<UnitGate>()("@app/UnitGate", {
  payload: Schema.Void,
  success: Schema.Number,
  effect: () => Effect.succeed(1),
}) {}

class InputGate extends Gate.Tag<InputGate>()("@app/InputGate", { payload: Schema.Number, success: Schema.Number }) {}

// @ts-expect-error — void gates reject positional input
void UnitGate.run(1);

// @ts-expect-error — parameterized gates require input
void InputGate.run();

type _GateHandleKeys = keyof Gate.RunHandle<number, number, never>;
declare const _statusAbsent: _GateHandleKeys extends "status" ? true : false;
void (_statusAbsent satisfies false);

declare const _observableHasStatus: "status" extends keyof Gate.Handle<
  number,
  number,
  never
>
  ? true
  : false;
void (_observableHasStatus satisfies true);

// RateLimitOptions tracks Effect RateLimiter.consume options (key optional).
type EffectConsumeOptions = Parameters<RateLimiter["consume"]>[0];
declare const _fullConsume: EffectConsumeOptions;
const _asGateOptions: Gate.RateLimitOptions = _fullConsume;
void _asGateOptions;
const _withoutKey: Gate.RateLimitOptions = {
  limit: 10,
  window: Duration.seconds(1),
  algorithm: "token-bucket",
  onExceeded: "fail",
  tokens: 2,
};
void _withoutKey;
// Gate.RateLimiterConsumeOptions is the upstream shape (key required).
const _upstream: Gate.RateLimiterConsumeOptions = {
  key: "k",
  limit: 1,
  window: "1 second",
};
void _upstream;
