/**
 * Compose data door — named methods return typed bundles.
 */
import { expectTypeOf } from "vitest";
import { Schema } from "effect";
import * as Node from "../src/Node";
import * as WorkPool from "../src/WorkPool";
import * as Daemon from "../src/Daemon";
import type { DaemonBundle, QueueBundle } from "../src/ui/data";
import type { DataDoor } from "../src/ui/runtime";

const Item = Schema.Struct({ n: Schema.Number });
class AppNode extends Node.Tag<AppNode>()("app/data-d/Node", {
  url: "http://127.0.0.1:9/rpc",
  kind: "Http",
}) {}
class Jobs extends WorkPool.Tag<Jobs>()("app/data-d/Jobs", {
  payload: Item,
  node: AppNode,
}) {}
class Nightly extends Daemon.Tag<Nightly>()("app/data-d/Nightly", {
  node: AppNode,
}) {}

declare const door: DataDoor;

expectTypeOf(door.queue(Jobs)).toEqualTypeOf<QueueBundle>();
expectTypeOf(door.daemon(Nightly)).toEqualTypeOf<DaemonBundle>();
