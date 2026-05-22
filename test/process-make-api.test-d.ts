import { Duration, Effect } from "effect";
import { Polling, Process, ProcessSchedule } from "../src";

// @ts-expect-error Process.make requires (id, config) or (id, effect)
Process.make({ name: "legacy", effect: Effect.void });

// @ts-expect-error second argument is required
Process.make("@app/OnlyId");

const _config = Process.make("@app/Valid", { effect: Effect.void });

const _effectOnly = Process.make("@app/Valid", Effect.void);

const _withPolling = Process.make(
  "@app/Valid",
  Effect.void,
  Polling.spaced(Duration.seconds(1)),
);

const _scheduleThenPolling = Process.make(
  "@app/Valid",
  Effect.void,
  ProcessSchedule.empty,
  Polling.spaced(Duration.seconds(1)),
);

const _pollingThenSchedule = Process.make(
  "@app/Valid",
  Effect.void,
  Polling.spaced(Duration.seconds(1)),
  ProcessSchedule.inMemory([]),
);

class Heartbeat extends Process.Service<Heartbeat>()(
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
