import { Duration, Effect } from "effect";
import { Polling, Daemon } from "../src";

// @ts-expect-error Daemon.make requires (id, config) or (id, effect)
Daemon.make({ name: "legacy", effect: Effect.void });

// @ts-expect-error second argument is required
Daemon.make("@app/OnlyId");

const _config = Daemon.make("@app/Valid", { effect: Effect.void });

const _effectOnly = Daemon.make("@app/Valid", Effect.void);

const _withPolling = Daemon.make(
  "@app/Valid",
  Effect.void,
  Polling.spaced(Duration.seconds(1)),
);

const _scheduleThenPolling = Daemon.make(
  "@app/Valid",
  Effect.void,
  Daemon.scheduleInMemory(),
  Polling.spaced(Duration.seconds(1)),
);

const _pollingThenSchedule = Daemon.make(
  "@app/Valid",
  Effect.void,
  Polling.spaced(Duration.seconds(1)),
  Daemon.scheduleInMemory([]),
);

class Heartbeat extends Daemon.Service<Heartbeat>()(
  "@app/Heartbeat",
  Effect.void,
  Polling.spaced(Duration.seconds(1)),
) {}

void _config;
void _effectOnly;
void _withPolling;
void _scheduleThenPolling;
void _pollingThenSchedule;
void Heartbeat;
