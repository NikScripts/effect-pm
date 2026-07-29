/**
 * Observe.use — pack field presence for queue / daemon.
 */
import { expectTypeOf } from "vitest";
import * as Observe from "../src/Observe";
import * as DaemonView from "../src/ui/DaemonView";
import * as WorkPoolView from "../src/ui/WorkPoolView";
import type { DaemonTag, QueueTag } from "../src/ui/data";

declare const jobs: QueueTag;
declare const nightly: DaemonTag;

const queueBox = Observe.use(jobs, WorkPoolView.pack);
const daemonBox = Observe.use(nightly, DaemonView.pack);

expectTypeOf(queueBox).toHaveProperty("status");
expectTypeOf(queueBox).toHaveProperty("pause");
expectTypeOf(queueBox).toHaveProperty("logs");
expectTypeOf(daemonBox).toHaveProperty("status");
expectTypeOf(daemonBox).toHaveProperty("start");
