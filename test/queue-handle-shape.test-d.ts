import { Effect, Schema, Stream } from "effect";
import type { QueueHandle } from "../src/internal/workPool";
import type { queueStatus } from "../src/WorkPool";
import type { WorkPoolPriorityHandle } from "../src/internal/workPoolPriority";
import type { priorityStatus } from "../src/WorkPool";
import * as Hyperlink from "../src/Hyperlink";

type QueueStatus = Schema.Schema.Type<typeof queueStatus>;
type CustomStatus = Schema.Schema.Type<typeof priorityStatus>;

// QueueHandle.status is a Subscribable ref — not a bare stream, and statusNow is removed.
type Handle = QueueHandle<number>;
type StatusShape = Handle["status"];

type StatusIsSubscribable = StatusShape extends Hyperlink.Subscribable<QueueStatus>
  ? true
  : false;
true satisfies StatusIsSubscribable;

type StatusGet = StatusShape["get"] extends Effect.Effect<QueueStatus> ? true : false;
true satisfies StatusGet;

type StatusChanges = StatusShape["changes"] extends Stream.Stream<QueueStatus> ? true : false;
true satisfies StatusChanges;

type StatusNowAbsent = "statusNow" extends keyof Handle ? false : true;
true satisfies StatusNowAbsent;

// WorkPoolPriorityHandle mirrors the same ref shape.
type CustomHandle = WorkPoolPriorityHandle<string>;
type CustomStatusShape = CustomHandle["status"];

type CustomStatusIsSubscribable = CustomStatusShape extends Hyperlink.Subscribable<CustomStatus>
  ? true
  : false;
true satisfies CustomStatusIsSubscribable;

type CustomStatusNowAbsent = "statusNow" extends keyof CustomHandle ? false : true;
true satisfies CustomStatusNowAbsent;
