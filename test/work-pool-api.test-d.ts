import { Effect, Schema } from "effect";
import { WorkPool } from "../src";

interface Email {
  readonly to: string;
}

const EmailSchema = Schema.Struct({ to: Schema.String });

// @ts-expect-error WorkPool.make requires effect or config
const _invalidMake = WorkPool.make({ concurrency: 1 });
void _invalidMake;

class EmailQueue extends WorkPool.define<EmailQueue, Email, never>()(
  "@app/EmailQueue",
  (_email) => Effect.void,
) {}

class EmailQueueWithOptions extends WorkPool.define<EmailQueueWithOptions, Email, never>()(
  "@app/EmailQueueWithOptions",
  (_email) => Effect.void,
  { concurrency: 3 },
) {}

class SchemaEmailQueue extends WorkPool.define<SchemaEmailQueue, Email, never>()(
  "@app/SchemaEmailQueue",
  (_email) => Effect.void,
  { itemSchema: EmailSchema, concurrency: 1 },
) {}

// Tag/layer are the unified (toolkit) forms: a service tag keyed by id + item schema, and a
// config-object layer. (make/Service above remain the engine helpers, kept via the spread.)
class NotificationTag extends WorkPool.Service<NotificationTag>()("@app/NotificationTag", {
  payload: EmailSchema,
}) {}

const _makeEffectOnly = Effect.scoped(
  WorkPool.make((item: string) => Effect.logInfo(item)),
);

const _makeWithOptions = Effect.scoped(
  WorkPool.make((item: string) => Effect.logInfo(item), { concurrency: 2 }),
);

const _layer = WorkPool.layerMemory(NotificationTag, {
  effect: (_email) => Effect.void,
  concurrency: 1,
});

void EmailQueue;
void EmailQueueWithOptions;
void SchemaEmailQueue;
void _makeEffectOnly;
void _makeWithOptions;
void _layer;
