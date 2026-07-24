import { Effect, Schema } from "effect";
import * as Daemon from "../src/Daemon";
import * as Store from "../src/Store";
import {
  builtInDaemonStoreContract,
  type BuiltInDaemonContract,
  type DaemonStoreEvent,
} from "../src/internal/store/daemonStoreSpec";

const Price = Schema.Struct({ symbol: Schema.String, usd: Schema.Number });

class PricedDaemon extends Daemon.Tag<PricedDaemon>()("test/store/Priced", { success: Price }) {}

type Contract = BuiltInDaemonContract<typeof PricedDaemon>;
type Handle = Store.HandleOf<Contract>;

declare const _handle: Handle;

// Cast-free: factory return is assignable to the declared built-in contract type.
void ({} as ReturnType<typeof builtInDaemonStoreContract<typeof PricedDaemon>> satisfies Contract);

void _handle.record({
  _tag: "Completed",
  key: PricedDaemon.key,
  scheduleKey: null,
  startedAt: 1,
  completedAt: 2,
  durationMs: 1,
  isStartupRun: true,
  success: { symbol: "AAPL", usd: 1 },
});

type Event = DaemonStoreEvent<typeof PricedDaemon>;
type EventsResult = ReturnType<Handle["events"]> extends Effect.Effect<
  infer A,
  infer _E,
  infer _R
>
  ? A
  : never;

void ({} as EventsResult satisfies ReadonlyArray<Event>);
