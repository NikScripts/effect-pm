/**
 * **Process contract (control surface)** — the fixed-schema service of a managed
 * {@link Process} expressed as a {@link Resource} {@link Spec}, so a long-running process
 * can be driven **remotely** over RPC through the toolkit's location-transparent layers
 * (the same `yield* Tag` code runs local or remote; only the provided layer changes).
 *
 * @remarks
 * This is the **first slice** of porting `Process` onto the toolkit — the control /
 * observation verbs, all of which have fixed schemas (a process has no per-instance item
 * type, so unlike `QueueResource` every process shares one spec; it binds to a plain
 * {@link Resource.Tag}, not a per-item spec).
 *
 * The surface mirrors the engine's two observable/controllable seams:
 * - **`ProcessMirror`** (armed / active instances / next trigger / next schedule transition /
 *   next poll cadence) → the {@link processStatus} snapshot, exposed as `statusNow` (one-shot)
 *   and `status` (live stream).
 * - **`ProcessScheduleControls`** (entries / set / add / clear) → `schedule` (read) plus the
 *   `setSchedule` / `addSchedule` / `clearSchedule` mutations.
 *
 * Plus lifecycle (`start` / `stop` / `runImmediately`) and the captured `logs` stream (same
 * structured log schema the queue uses). Note there is **no** `arm`/`disarm` verb: `armed` is
 * **derived** from the schedule (a process is armed iff an entry currently places it in a run
 * window), so arming is done by mutating the schedule, not a manual toggle.
 *
 * The engine **control handle** these verbs forward to, and the `Tag` / `layer` / `server` /
 * `serveHttp` wiring, land in the next slice (they require exposing a controllable handle from
 * the `Process` supervisor — today the handle is only `{ effect, runImmediately }`).
 *
 * @module ProcessContract
 */
import { Schema } from "effect";
import { Resource } from "./Resource";
import { ProcessManagerLogEntrySchema } from "./LogEntry";

/**
 * A captured log line on the wire — the element of a process's `logs` stream. Reuses the
 * package's structured log schema ({@link ProcessManagerLogEntrySchema}: `date`, `level`,
 * `message`, `cause?`, `annotations`, `spans`), so every datapoint and the level are preserved
 * across RPC. (Re-exported under a process-neutral name.)
 *
 * @public
 */
export const processLogEntry = ProcessManagerLogEntrySchema;

/**
 * One scheduled run window on the wire — the wire form of the engine's `ProcessScheduleEntry`.
 * The engine models `id` / `stopAt` as `Option` and the times as `Date`; the toolkit standard
 * is `DateTime.Utc` and `optionalKey`, so the impl maps between them. `startAt` is when the run
 * instance triggers; `stopAt` (absent = open-ended) is when it stops.
 *
 * @public
 */
export const processScheduleEntry = Schema.Struct({
  id: Schema.optionalKey(Schema.String),
  startAt: Schema.DateTimeUtc,
  stopAt: Schema.optionalKey(Schema.DateTimeUtc),
});

/**
 * The current-state snapshot of a managed process — the engine's `ProcessMirror`. Element of
 * the `status` stream and the result of `statusNow`.
 *
 * - `supervising` — whether the trigger driver is currently running (toggled by `start`/`stop`).
 * - `armed` — whether the schedule currently has the process armed to trigger (derived from the
 *   schedule entries; independent of `supervising`).
 * - `activeInstances` — how many run instances are executing right now.
 * - `nextTriggerRun` — when the next run instance is expected to start (absent if disarmed/idle).
 * - `nextScheduleTransition` — when the schedule next changes armed/disarmed (absent if none).
 * - `nextPollCadence` — the in-instance repeat cadence, when polling is configured.
 *
 * @public
 */
export const processStatus = Schema.Struct({
  supervising: Schema.Boolean,
  armed: Schema.Boolean,
  activeInstances: Schema.Number,
  nextTriggerRun: Schema.optionalKey(Schema.DateTimeUtc),
  nextScheduleTransition: Schema.optionalKey(Schema.DateTimeUtc),
  nextPollCadence: Schema.optionalKey(Schema.Duration),
});

/**
 * The process **control + observation** contract: the fixed-schema verbs of a managed process,
 * shared by every process instance. Mirrors the controllable/observable members the engine
 * supervisor exposes (`ProcessMirror` + `ProcessScheduleControls` + lifecycle).
 *
 * @public
 */
export const processControlSpec = {
  // ─── Observation ───
  statusNow: Resource.query(processStatus).annotate({
    description:
      "One-shot current-state snapshot (armed, active instances, next trigger/transition, " +
      "poll cadence) — the `status` stream's element read once.",
  }),
  status: Resource.stream(processStatus).annotate({
    description:
      "Live current-state snapshot — emits the current process state and every change.",
  }),
  schedule: Resource.query(Schema.Array(processScheduleEntry)).annotate({
    description: "The process's current schedule entries (run windows), sorted by startAt.",
  }),
  logs: Resource.stream(processLogEntry).annotate({
    description:
      "Captured log lines (engine + instance effect) with level/annotations/spans — empty " +
      "unless the process was configured to capture logs.",
  }),

  // ─── Lifecycle ───
  start: Resource.mutate(Schema.Void).annotate({
    description: "Begin supervising — fork the trigger driver (idempotent).",
  }),
  stop: Resource.mutate(Schema.Void).annotate({
    description: "Stop supervising — interrupt the driver and any active run instances.",
    destructive: true,
  }),
  runImmediately: Resource.mutate(Schema.Void).annotate({
    description:
      "Run the process effect once with tracking, out of band — independent of the trigger cadence.",
  }),

  // ─── Schedule mutation (this is how you arm/disarm: armed is derived from entries) ───
  setSchedule: Resource.mutate(Schema.Void, {
    payload: Schema.Array(processScheduleEntry),
  }).annotate({
    description: "Replace all schedule entries.",
  }),
  addSchedule: Resource.mutate(Schema.Void, {
    payload: processScheduleEntry,
  }).annotate({
    description: "Append one schedule entry.",
  }),
  clearSchedule: Resource.mutate(Schema.Void).annotate({
    description: "Remove all schedule entries (disarms until new entries are added).",
    destructive: true,
  }),
};
// Note: no `satisfies Spec` — that would contextually widen each method's error channel to
// `unknown`. The spec is validated (without widening) at the `Resource.Tag` call site (slice 2).
