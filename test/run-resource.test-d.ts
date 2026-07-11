import { Effect, Schema } from "effect";
import * as RunResource from "../src/RunResource";

class UnitGate extends RunResource.Service<UnitGate>()("@app/UnitGate", {
  success: Schema.Number,
  effect: () => Effect.succeed(1),
}) {}

class InputGate extends RunResource.Tag<InputGate>()("@app/InputGate", {
  payload: Schema.Number,
  success: Schema.Number,
}) {}

// @ts-expect-error — unit gates reject positional input
void UnitGate.run(1);

// @ts-expect-error — parameterized gates require input
void InputGate.run();

type _GateHandleKeys = keyof RunResource.RunGateHandle<number, number, never>;
declare const _statusAbsent: _GateHandleKeys extends "status" ? true : false;
void (_statusAbsent satisfies false);

declare const _observableHasStatus: "status" extends keyof RunResource.RunResourceHandle<
  number,
  number,
  never
>
  ? true
  : false;
void (_observableHasStatus satisfies true);

declare const _unitRunIsEffect: typeof UnitGate.run extends Effect.Effect<number, never, UnitGate>
  ? true
  : false;
void (_unitRunIsEffect satisfies true);
