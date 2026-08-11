/**
 * Shared Tags + public/private Node identity for dream-redeploy Shape β.
 *
 * Public `Worker` = stable client Http. `WorkerPrivate` = same key + Unix A/B.
 * Port/socks are runtime args so edge and children share one address list.
 */
import { Schema } from "effect";
import * as Address from "../../src/Address";
import * as Hyperlink from "../../src/Hyperlink";
import * as Node from "../../src/Node";
import * as NodePolicy from "../../src/NodePolicy";
import * as WorkPool from "../../src/WorkPool";

/** Node identity — one key for edge + A/B backends. */
export const WORKER_NODE_KEY = "examples/dream-redeploy/Worker";

/** WorkPool payload — pending moves A→B before activate (interim until S14). */
export const Job = Schema.Struct({
  id: Schema.String,
  note: Schema.String,
});
export type Job = typeof Job.Type;

export class Jobs extends WorkPool.Service<Jobs>()(
  "examples/dream-redeploy/Jobs",
  { payload: Job },
) {}

/**
 * Tip probe — v1 answers `"v1"`, v2 answers `"v2"` so a public client
 * proves Active flipped after file-swap + activate.
 */
export class Probe extends Hyperlink.Service<Probe>()(
  "examples/dream-redeploy/Probe",
  {
    tip: Hyperlink.effect(Schema.String),
  },
) {}

/**
 * One public make + private pipe — same args in edge and children.
 */
export const makeDreamNodes = (
  httpPort: number,
  sockA: string,
  sockB: string,
) => {
  class Worker extends Node.make(
    WORKER_NODE_KEY,
    Address.http(`:${String(httpPort)}`),
  ) {}

  class WorkerPrivate extends Worker.pipe(
    Address.unix({ A: sockA, B: sockB }),
    NodePolicy.proxy("Prefer"),
  ) {}

  return { Worker, WorkerPrivate };
};
