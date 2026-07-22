import { Effect, Schema, Stream } from "effect";
import type { QueueHandle } from "../src/internal/queueResource";
import type { queueStatus } from "../src/QueueResource";
import type { CustomQueueHandle } from "../src/internal/customQueueResource";
import type { customQueueStatus } from "../src/CustomQueueResource";
import * as Hyperlink from "../src/Hyperlink";

type QueueStatus = Schema.Schema.Type<typeof queueStatus>;
type CustomStatus = Schema.Schema.Type<typeof customQueueStatus>;

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

// CustomQueueHandle mirrors the same ref shape.
type CustomHandle = CustomQueueHandle<string>;
type CustomStatusShape = CustomHandle["status"];

type CustomStatusIsSubscribable = CustomStatusShape extends Hyperlink.Subscribable<CustomStatus>
  ? true
  : false;
true satisfies CustomStatusIsSubscribable;

type CustomStatusNowAbsent = "statusNow" extends keyof CustomHandle ? false : true;
true satisfies CustomStatusNowAbsent;
