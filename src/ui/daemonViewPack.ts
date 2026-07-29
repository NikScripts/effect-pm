/**
 * Daemon observe pack — pipeable recipes for status / schedule / controls / logs.
 * @internal
 */
import { Effect, pipe, type Effect as EffectT, type Stream as StreamT } from "effect";
import * as Observe from "../Observe";
import type { DaemonStatus, ScheduleEntry } from "./data";
import { serviceLogs } from "./workPoolViewPack";

type DaemonSchedule = {
  readonly entries: { readonly get: EffectT.Effect<ReadonlyArray<ScheduleEntry>> };
  readonly set: (entries: ReadonlyArray<ScheduleEntry>) => EffectT.Effect<void>;
  readonly clear: EffectT.Effect<void>;
};

type Daemon = {
  readonly status: {
    readonly get: EffectT.Effect<DaemonStatus>;
    readonly changes: StreamT.Stream<DaemonStatus>;
  };
  readonly schedule?: DaemonSchedule | undefined;
  readonly start: EffectT.Effect<void>;
  readonly stop: EffectT.Effect<void>;
  readonly run: EffectT.Effect<void>;
};

const scheduleEntries = (p: Daemon): EffectT.Effect<ReadonlyArray<ScheduleEntry>> =>
  p.schedule === undefined
    ? Effect.succeed<ReadonlyArray<ScheduleEntry>>([])
    : p.schedule.entries.get;

/**
 * Full Daemon UI pack.
 *
 * @public
 */
export const pack = Observe.named(
  "daemon",
  pipe(
    Observe.struct({
      status: Observe.atom((p: Daemon) => p.status),
      schedule: Observe.poll(scheduleEntries, "3 seconds"),
      start: Observe.fn((p: Daemon) => p.start),
      stop: Observe.fn((p: Daemon) => p.stop),
      run: Observe.fn((p: Daemon) => p.run),
      setSchedule: Observe.fn(
        (p: Daemon) => (entries: ReadonlyArray<ScheduleEntry>) =>
          p.schedule === undefined ? Effect.void : p.schedule.set(entries),
      ),
      clearSchedule: Observe.fn((p: Daemon) =>
        p.schedule === undefined ? Effect.void : p.schedule.clear,
      ),
    }),
    Observe.and(serviceLogs),
  ),
);
