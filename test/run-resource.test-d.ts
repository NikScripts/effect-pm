import { Effect, Schema } from "effect";
import * as RunHyperlink from "../src/RunHyperlink";

class UnitGate extends RunHyperlink.Service<UnitGate>()("@app/UnitGate", {
  payload: Schema.Void,
  success: Schema.Number,
  effect: () => Effect.succeed(1),
}) {}

class InputGate extends RunHyperlink.Tag<InputGate>()("@app/InputGate", { payload: Schema.Number, success: Schema.Number }) {}

// @ts-expect-error — void gates reject positional input
void UnitGate.run(1);

// @ts-expect-error — parameterized gates require input
void InputGate.run();

type _GateHandleKeys = keyof RunHyperlink.RunGateHandle<number, number, never>;
declare const _statusAbsent: _GateHandleKeys extends "status" ? true : false;
void (_statusAbsent satisfies false);

declare const _observableHasStatus: "status" extends keyof RunHyperlink.RunHyperlinkHandle<
  number,
  number,
  never
>
  ? true
  : false;
void (_observableHasStatus satisfies true);
