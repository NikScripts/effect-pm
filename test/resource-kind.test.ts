import { Schema } from "effect";
import { expect, it } from "vitest";
import * as Resource from "../src/Resource";
import * as QueueResource from "../src/QueueResource";
import * as Process from "../src/Process";
import * as CustomQueueResource from "../src/CustomQueueResource";
import * as ApiMetrics from "../src/ApiMetrics";

// Each contract stamps its canonical kind on the tag, so `Resource.kindOf` classifies a tag
// without sniffing its spec. Every tag carries a kind: a bare `Resource.Tag` defaults to
// `Resource.kind` (`…/Resource`), so nothing is ever kind-less.
const Item = Schema.Struct({ n: Schema.Number });

class Q extends QueueResource.Tag<Q>()("kindtest/Q", { payload: Item }) {}
class P extends Process.Tag<P>()("kindtest/P") {}
class C extends CustomQueueResource.Tag<C>()("kindtest/C", { payload: Item, levelCount: 3 }) {}
class M extends ApiMetrics.Tag<M>()("kindtest/M") {}
class Bare extends Resource.Tag<Bare>()("kindtest/Bare", {
  ping: Resource.effect(Schema.String),
}) {}

it("each contract stamps its kind; a bare Resource.Tag defaults to Resource.kind", () => {
  expect(Resource.kindOf(Q)).toBe(QueueResource.kind);
  expect(Resource.kindOf(P)).toBe(Process.kind);
  expect(Resource.kindOf(C)).toBe(CustomQueueResource.kind);
  expect(Resource.kindOf(M)).toBe(ApiMetrics.kind);
  expect(Resource.kindOf(Bare)).toBe(Resource.kind);
  expect(Resource.kind).toBe("@nikscripts/effect-pm/Resource");
});

it("kindOf is safe on non-tags", () => {
  expect(Resource.kindOf(undefined)).toBeUndefined();
  expect(Resource.kindOf({})).toBeUndefined();
  expect(Resource.kindOf("nope")).toBeUndefined();
});
