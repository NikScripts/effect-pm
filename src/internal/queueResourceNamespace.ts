/**
 * @module internal/queueResourceNamespace
 *
 * The single **`QueueResource`** namespace — the public `@nikscripts/effect-pm/QueueResource`
 * subpath resolves here (not the engine), so `QueueResource.Tag` is the **contract** tag (the
 * one with the `host` overload + `itemSchema`), consumed as a tree-shakeable module namespace:
 *
 *   import * as QueueResource from "@nikscripts/effect-pm/QueueResource";
 *   class Mail extends QueueResource.Tag<Mail>()("@app/Mail", JobSchema, { host: MyHost }) {}
 *
 * - `Tag` / `configure` come from the **light** contract (`QueueContract`).
 * - `layer` / `serve` / `server` / `serveHttp` / `serverEntry` are the runtime verbs (pull the engine
 *   only when used).
 * - `make` / `Service` / `Schema` / `Errors` / `rateLimiterLayer` are the engine helpers.
 */
import { Tag, configure, layer, serve, serveHttp, server, serverEntry } from "../QueueContract";
import { QueueResource as engine } from "../QueueResource";

const make = engine.make;
const Service = engine.Service;
const Schema = engine.Schema;
const Errors = engine.Errors;
const rateLimiterLayer = engine.rateLimiterLayer;

export { Tag, configure, layer, serve, server, serveHttp, serverEntry, make, Service, Schema, Errors, rateLimiterLayer };

// engine error classes / schemas / helpers — re-exported so the /QueueResource subpath
// (which resolves to this module) still surfaces them for consumers.
export {
  QueueItemValidationError,
  QueueBatchValidationError,
  QueueMissingItemSchemaError,
  QueueItemEncodingError,
  QueueShutdownError,
  QueueItemCodecDescriptorSchema,
  makeQueueItemCodecDescriptor,
  queueRateLimiterLayer,
  schemaVersionAnnotation,
  schemaVersionOf,
  withSchemaVersion,
} from "../QueueResource";
export type { EffectContext, QueueEntry, QueueHandle } from "../QueueResource";
