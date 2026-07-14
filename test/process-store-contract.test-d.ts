import { Effect, Schema } from "effect";
import * as Process from "../src/Process";
import * as Store from "../src/Store";
import {
  builtInProcessStoreContract,
  type BuiltInProcessContract,
  type ProcessStoreEvent,
} from "../src/internal/store/processStoreSpec";

const Price = Schema.Struct({ symbol: Schema.String, usd: Schema.Number });

class PricedProc extends Process.Tag<PricedProc>()("test/store/Priced", { success: Price }) {}

type Contract = BuiltInProcessContract<typeof PricedProc>;
type Handle = Store.HandleOf<Contract>;

declare const _handle: Handle;

// Cast-free: factory return is assignable to the declared built-in contract type.
void ({} as ReturnType<typeof builtInProcessStoreContract<typeof PricedProc>> satisfies Contract);

void _handle.record({
  _tag: "Completed",
  key: PricedProc.key,
  scheduleKey: null,
  startedAt: 1,
  completedAt: 2,
  durationMs: 1,
  isStartupRun: true,
  success: { symbol: "AAPL", usd: 1 },
});

type Event = ProcessStoreEvent<typeof PricedProc>;
type EventsResult = ReturnType<Handle["events"]> extends Effect.Effect<
  infer A,
  infer _E,
  infer _R
>
  ? A
  : never;

void ({} as EventsResult satisfies ReadonlyArray<Event>);
