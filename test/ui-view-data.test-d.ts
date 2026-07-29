/**
 * Observe.use — typed pack discharge (replaces retired DataDoor).
 */
import { expectTypeOf } from "vitest";
import { Schema } from "effect";
import * as Node from "../src/Node";
import * as WorkPool from "../src/WorkPool";
import * as Daemon from "../src/Daemon";
import * as Observe from "../src/Observe";
import * as DaemonView from "../src/ui/DaemonView";
import * as WorkPoolView from "../src/ui/WorkPoolView";

const Item = Schema.Struct({ n: Schema.Number });
class AppNode extends Node.Tag<AppNode>()("app/runtime-d/Node", {
  url: "http://127.0.0.1:9/rpc",
  kind: "Http",
}) {}
class Jobs extends WorkPool.Tag<Jobs>()("app/runtime-d/Jobs", {
  payload: Item,
  node: AppNode,
}) {}
class Nightly extends Daemon.Tag<Nightly>()("app/runtime-d/Nightly", {
  node: AppNode,
}) {}

expectTypeOf(Observe.use).toBeCallableWith(Jobs, WorkPoolView.pack);
expectTypeOf(Observe.use).toBeCallableWith(Nightly, DaemonView.pack);
expectTypeOf(Observe.use(Jobs, WorkPoolView.pack)).toHaveProperty("status");
expectTypeOf(Observe.use(Nightly, DaemonView.pack)).toHaveProperty("start");
