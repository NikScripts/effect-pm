/**
 * @module examples/web-dashboard/fleet
 *
 * The fleet, defined **once, as tags** — shared by the server (which hosts them) and
 * the browser (which reaches them via `Resource.client`). The `Group.Tag` tree IS the
 * navigation tree; the leaf tags ARE the registry. No hand-rolled `REGISTRY`/`TREE`.
 */
import { Duration, Effect, Schema } from "effect";
import { queueTag } from "../../src/QueueContract";
import { processTag } from "../../src/ProcessContract";
import { Group } from "../../src/Group";

const Job = Schema.Struct({ id: Schema.String });

// leaf queue tags
export class Mail extends queueTag<Mail>()("@acme/queues/Mail", Job) {}
export class Jobs extends queueTag<Jobs>()("@acme/queues/Jobs", Job) {}
export class Billing extends queueTag<Billing>()("@acme/queues/Billing", Job) {}
export class Notify extends queueTag<Notify>()("@acme/queues/Notify", Job) {}
export class Worker1 extends queueTag<Worker1>()("@acme/queues/Worker1", Job) {}
export class Worker2 extends queueTag<Worker2>()("@acme/queues/Worker2", Job) {}
export class Worker3 extends queueTag<Worker3>()("@acme/queues/Worker3", Job) {}
export class RegionUS extends queueTag<RegionUS>()("@acme/queues/RegionUS", Job) {}
export class RegionEU extends queueTag<RegionEU>()("@acme/queues/RegionEU", Job) {}
export class Daily extends queueTag<Daily>()("@acme/queues/Daily", Job) {}
export class Weekly extends queueTag<Weekly>()("@acme/queues/Weekly", Job) {}

// a process (the wow "Mini" home server runs a wnba key-rotation detect+fix process)
export class KeyRotation extends processTag<KeyRotation>()("@wnba/Mini/KeyRotation") {}

// the group tree — this is the navigable tree, nothing more is needed
export class Mini extends Group.Tag<Mini>("@wnba/Mini")({ KeyRotation }) {}
export class Regional extends Group.Tag<Regional>("@acme/queues/Regional")({ RegionUS, RegionEU }) {}
export class Workers extends Group.Tag<Workers>("@acme/queues/Workers")({ Worker1, Worker2, Worker3, Regional }) {}
export class Reports extends Group.Tag<Reports>("@acme/queues/Reports")({ Daily, Weekly }) {}
export class Fleet extends Group.Tag<Fleet>("@acme/queues/Ops")({
  Mail,
  Jobs,
  Billing,
  Workers,
  Reports,
  Notify,
  Mini,
}) {}

/** Every leaf queue tag (the ones the server hosts / the client connects to). */
export const LEAVES = [
  Mail,
  Jobs,
  Billing,
  Notify,
  Worker1,
  Worker2,
  Worker3,
  RegionUS,
  RegionEU,
  Daily,
  Weekly,
] as const;

/** The http path segment for a tag (`@acme/queues/Mail` → `Mail`), unique across the fleet. */
export const pathOf = (id: string): string => id.split("/").pop() ?? id;

let rngState = 0x2545f491;
const rng = (): number => {
  rngState = (rngState * 1664525 + 1013904223) >>> 0;
  return rngState / 0x100000000;
};

class WorkerError extends Schema.ErrorClass<WorkerError>("WorkerError")({
  _tag: Schema.tag("WorkerError"),
  id: Schema.String,
}) {}

/** Shared worker config (server-side): logs each step, varies duration, fails sometimes. */
export const cfg = {
  effect: (job: { readonly id: string }) =>
    Effect.gen(function* () {
      yield* Effect.logInfo(`processing ${job.id}`);
      yield* Effect.sleep(Duration.millis(250 + Math.floor(rng() * 900)));
      if (rng() < 0.1) {
        yield* Effect.logError(`failed ${job.id}`);
        return yield* new WorkerError({ id: job.id });
      }
      yield* Effect.logInfo(`completed ${job.id}`);
      return job;
    }),
  concurrency: 3,
  attempts: 2,
  captureLogs: true,
} as const;
