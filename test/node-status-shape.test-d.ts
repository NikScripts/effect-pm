import { Effect, Schema, Stream } from "effect";
import { NodeStatusHyperlink, nodeStatus } from "../src/internal/nodeStatusHyperlink";
import * as Hyperlink from "../src/Hyperlink";

type NodeStatusValue = Schema.Schema.Type<typeof nodeStatus>;
type Service = Hyperlink.ShapeOf<
  Hyperlink.SpecOf<typeof NodeStatusHyperlink>,
  typeof NodeStatusHyperlink
>;

type StatusIsSubscribable = Service["status"] extends Hyperlink.Subscribable<NodeStatusValue>
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
  readonly stream: Stream.Stream<unknown>;
  readonly query: (payload: { readonly limit: number }) => Effect.Effect<ReadonlyArray<unknown>>;
}
  ? true
  : false;
true satisfies LogsNested;

type LogHistoryAbsent = "logHistory" extends keyof Service ? false : true;
true satisfies LogHistoryAbsent;
