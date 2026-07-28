/**
 * Bundle.observe — overload returns.
 */
import { expectTypeOf } from "vitest";
import * as Bundle from "../src/ui/Bundle";
import type {
  DaemonBundle,
  DaemonTag,
  QueueBundle,
  QueueTag,
} from "../src/ui/data";

declare const jobs: QueueTag;
declare const nightly: DaemonTag;

const queueBox = Bundle.observe(jobs);
const daemonBox = Bundle.observe(nightly);
expectTypeOf(queueBox).toEqualTypeOf<QueueBundle>();
expectTypeOf(daemonBox).toEqualTypeOf<DaemonBundle>();
