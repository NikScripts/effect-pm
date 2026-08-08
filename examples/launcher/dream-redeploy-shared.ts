/**
 * Shared Tags / payload for dream-redeploy v1↔v2 workers + orchestrator.
 * Wire keys stay stable across the file-swap tip change.
 */
import { Schema } from "effect";
import * as Hyperlink from "../../src/Hyperlink";
import * as WorkPool from "../../src/WorkPool";

/** Directory / custody identity — same for A and B (dial-replace). */
export const WORKER_NODE_KEY = "examples/dream-redeploy/Worker";

/** WorkPool payload — pending survives A→B via baked `releaseEnqueueHandoff`. */
export const Job = Schema.Struct({
  id: Schema.String,
  note: Schema.String,
});
export type Job = typeof Job.Type;

export class Jobs extends WorkPool.Tag<Jobs>()(
  "examples/dream-redeploy/Jobs",
  { payload: Job },
) {}

/**
 * Tip probe — v1 answers `"v1"`, v2 answers `"v2"` so a sticky `lookupClient`
 * proves the facade moved to the swapped binary.
 */
export class Probe extends Hyperlink.Tag<Probe>()(
  "examples/dream-redeploy/Probe",
  {
    tip: Hyperlink.effect(Schema.String),
  },
) {}
