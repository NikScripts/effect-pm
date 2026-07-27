import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import { expect, it } from "vitest";
import * as Hyperlink from "../src/Hyperlink";
import * as WorkPool from "../src/WorkPool";
import * as Daemon from "../src/Daemon";
import * as Gate from "../src/Gate";
import * as FleetHealth from "../src/FleetHealth";
import * as Telemetry from "../src/Telemetry";

// Each contract stamps its canonical kind on the tag, so `Hyperlink.kindOf` classifies a tag
// without sniffing its spec. Every tag carries a kind: a bare `Hyperlink.Tag` defaults to
// `Hyperlink.kind` (`…/Hyperlink`), so nothing is ever kind-less.
const Item = Schema.Struct({ n: Schema.Number });

const ping = HttpApiEndpoint.get("ping", "/ping", {
  success: Schema.Struct({ pong: Schema.Boolean }),
});
const api = HttpApi.make("kindtest-api").add(HttpApiGroup.make("g").add(ping));

class Q extends WorkPool.Tag<Q>()("kindtest/Q", { payload: Item }) {}
class P extends Daemon.Tag<P>()("kindtest/P") {}
class C extends WorkPool.priority<C>()("kindtest/C", { payload: Item, laneCount: 3 }) {}
class M extends Gate.HttpApiClient<M>()("kindtest/M", api) {}
class T extends Telemetry.Tag<T>()() {}
class F extends FleetHealth.Tag<F>()() {}
class Bare extends Hyperlink.Tag<Bare>()("kindtest/Bare", {
  ping: Hyperlink.effect(Schema.String),
}) {}

it("each contract stamps its kind; a bare Hyperlink.Tag defaults to Hyperlink.kind", () => {
  expect(Hyperlink.kindOf(Q)).toBe(WorkPool.kind);
  expect(Hyperlink.kindOf(P)).toBe(Daemon.kind);
  expect(Hyperlink.kindOf(C)).toBe(WorkPool.priorityKind);
  expect(Hyperlink.kindOf(M)).toBe(Gate.httpApiClientKind);
  expect(Hyperlink.kindOf(T)).toBe(Telemetry.kind);
  expect(Hyperlink.kindOf(F)).toBe(FleetHealth.kind);
  expect(Hyperlink.kindOf(Bare)).toBe(Hyperlink.kind);
  expect(Hyperlink.kind).toBe("hyperlink-ts/Hyperlink");
});

it("kindOf is safe on non-tags", () => {
  expect(Hyperlink.kindOf(undefined)).toBeUndefined();
  expect(Hyperlink.kindOf({})).toBeUndefined();
  expect(Hyperlink.kindOf("nope")).toBeUndefined();
});
