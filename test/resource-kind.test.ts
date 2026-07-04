import { Schema } from "effect";
import { expect, it } from "vitest";
import * as Resource from "../src/Resource";
import * as QueueResource from "../src/QueueResource";
import * as ScheduledProcess from "../src/ScheduledProcess";
import * as CustomQueueResource from "../src/CustomQueueResource";
import * as ApiMetrics from "../src/ApiMetrics";

// Each contract stamps its canonical kind on the tag, so `Resource.kindOf` classifies a tag
// without sniffing its spec (and a bare `Resource.Tag` reports no kind).
const Item = Schema.Struct({ n: Schema.Number });

class Q extends QueueResource.Tag<Q>()("kindtest/Q", Item) {}
class P extends ScheduledProcess.Tag<P>()("kindtest/P") {}
class C extends CustomQueueResource.Tag<C>()("kindtest/C", Item, 3) {}
class M extends ApiMetrics.Tag<M>()("kindtest/M") {}
class Bare extends Resource.Tag<Bare>()("kindtest/Bare", {
  ping: Resource.effect(Schema.String),
}) {}

it("each contract stamps its kind; a bare Resource.Tag has none", () => {
  expect(Resource.kindOf(Q)).toBe(QueueResource.kind);
  expect(Resource.kindOf(P)).toBe(ScheduledProcess.kind);
  expect(Resource.kindOf(C)).toBe(CustomQueueResource.kind);
  expect(Resource.kindOf(M)).toBe(ApiMetrics.kind);
  expect(Resource.kindOf(Bare)).toBeUndefined();
});

it("kindOf is safe on non-tags", () => {
  expect(Resource.kindOf(undefined)).toBeUndefined();
  expect(Resource.kindOf({})).toBeUndefined();
  expect(Resource.kindOf("nope")).toBeUndefined();
});
