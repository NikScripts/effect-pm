import { Effect, Schema, Stream } from "effect";
import { NodeStatusResource, nodeStatus } from "../src/internal/nodeStatusResource";
import * as Resource from "../src/Resource";

type NodeStatusValue = Schema.Schema.Type<typeof nodeStatus>;
type Service = Resource.ShapeOf<
  Resource.SpecOf<typeof NodeStatusResource>,
  typeof NodeStatusResource
>;

type StatusIsSubscribable = Service["status"] extends Resource.Subscribable<NodeStatusValue>
  ? true
  : false;
true satisfies StatusIsSubscribable;

type StatusGet = Service["status"]["get"] extends Effect.Effect<NodeStatusValue> ? true : false;
true satisfies StatusGet;

type StatusChanges = Service["status"]["changes"] extends Stream.Stream<NodeStatusValue>
  ? true
  : false;
true satisfies StatusChanges;

type StatusNowAbsent = "statusNow" extends keyof Service ? false : true;
true satisfies StatusNowAbsent;

type LogsNested = Service["logs"] extends {
  readonly live: Stream.Stream<unknown>;
  readonly history: (payload: { readonly limit: number }) => Effect.Effect<ReadonlyArray<unknown>>;
}
  ? true
  : false;
true satisfies LogsNested;

type LogHistoryAbsent = "logHistory" extends keyof Service ? false : true;
true satisfies LogHistoryAbsent;
