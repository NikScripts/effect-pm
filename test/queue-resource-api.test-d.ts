import { Effect, Schema } from "effect";
import { QueueResource } from "../src";

interface Email {
  readonly to: string;
}

const EmailSchema = Schema.Struct({ to: Schema.String });

// @ts-expect-error QueueResource.make requires effect or config
const _invalidMake = QueueResource.make({ concurrency: 1 });
void _invalidMake;

class EmailQueue extends QueueResource.Service<EmailQueue, Email, never>()(
  "@app/EmailQueue",
  (_email) => Effect.void,
) {}

class EmailQueueWithOptions extends QueueResource.Service<EmailQueueWithOptions, Email, never>()(
  "@app/EmailQueueWithOptions",
  (_email) => Effect.void,
  { concurrency: 3 },
) {}

class SchemaEmailQueue extends QueueResource.Service<SchemaEmailQueue, Email, never>()(
  "@app/SchemaEmailQueue",
  (_email) => Effect.void,
  { itemSchema: EmailSchema, concurrency: 1 },
) {}

// Tag/layer are the unified (toolkit) forms: a service tag keyed by id + item schema, and a
// config-object layer. (make/Service above remain the engine helpers, kept via the spread.)
class NotificationTag extends QueueResource.Tag<NotificationTag>()("@app/NotificationTag", {
  payload: EmailSchema,
}) {}

const _makeEffectOnly = Effect.scoped(
  QueueResource.make((item: string) => Effect.logInfo(item)),
);

const _makeWithOptions = Effect.scoped(
  QueueResource.make((item: string) => Effect.logInfo(item), { concurrency: 2 }),
);

const _layer = QueueResource.layerMemory(NotificationTag, {
  effect: (_email) => Effect.void,
  concurrency: 1,
});

void EmailQueue;
void EmailQueueWithOptions;
void SchemaEmailQueue;
void _makeEffectOnly;
void _makeWithOptions;
void _layer;
