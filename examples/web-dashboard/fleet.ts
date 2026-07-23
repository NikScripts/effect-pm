/**
 * @module examples/web-dashboard/fleet
 *
 * The fleet, defined **once, as tags** — shared by the server (which nodes them) and
 * the browser (which reaches them via `Hyperlink.client`). The `Group.Tag` tree IS the
 * navigation tree; the leaf tags ARE the registry. No hand-rolled `REGISTRY`/`TREE`.
 */
import { Duration, Effect, Schema } from "effect";
import * as WorkPool from "../../src/WorkPool";
import * as Daemon from "../../src/Daemon";
import * as Group from "../../src/Group";
import * as Node from "../../src/Node";

/** The Mini — a second machine (your home server). Resources bound to it run + are
 *  reached there; everything else is on the Droplet. */
export class MiniNode extends Node.Tag<MiniNode>()("hub/miniNode") {}

/** The Droplet — the main node. Every queue is bound to it, so they're served as one
 *  group on one port (`Node.httpServer`) and reached over one client transport. */
export class Droplet extends Node.Tag<Droplet>()("hub/droplet") {}

const Job = Schema.Struct({ id: Schema.String });

// leaf queue tags
export class Mail extends WorkPool.Tag<Mail>()("@acme/queues/Mail", { payload: Job, node: Droplet }) {}
export class Jobs extends WorkPool.Tag<Jobs>()("@acme/queues/Jobs", { payload: Job, node: Droplet }) {}
export class Billing extends WorkPool.Tag<Billing>()("@acme/queues/Billing", { payload: Job, node: Droplet }) {}
export class Notify extends WorkPool.Tag<Notify>()("@acme/queues/Notify", { payload: Job, node: Droplet }) {}
export class Worker1 extends WorkPool.Tag<Worker1>()("@acme/queues/Worker1", { payload: Job, node: Droplet }) {}
export class Worker2 extends WorkPool.Tag<Worker2>()("@acme/queues/Worker2", { payload: Job, node: Droplet }) {}
export class Worker3 extends WorkPool.Tag<Worker3>()("@acme/queues/Worker3", { payload: Job, node: Droplet }) {}
export class RegionUS extends WorkPool.Tag<RegionUS>()("@acme/queues/RegionUS", { payload: Job, node: Droplet }) {}
export class RegionEU extends WorkPool.Tag<RegionEU>()("@acme/queues/RegionEU", { payload: Job, node: Droplet }) {}
export class Daily extends WorkPool.Tag<Daily>()("@acme/queues/Daily", { payload: Job, node: Droplet }) {}
export class Weekly extends WorkPool.Tag<Weekly>()("@acme/queues/Weekly", { payload: Job, node: Droplet }) {}

// a process bound to the Mini node — it runs there, not on the Droplet.
export class KeyRotation extends Daemon.Tag<KeyRotation>()("@wnba/Mini/KeyRotation", {
  node: MiniNode,
}) {}

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

/** Every leaf queue tag (the ones the server nodes / the client connects to). */
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
} as const;
