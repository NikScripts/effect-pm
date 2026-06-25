/**
 * @module internal/queueResourceNamespace
 *
 * The single **`QueueResource`** namespace, assembled from per-member named exports so that
 * `export * as QueueResource` (in the barrel) tree-shakes per member:
 *
 * - `Tag` / `configure` come from the **light** contract (`QueueContract`) — using
 *   `QueueResource.Tag` pulls zero engine code.
 * - `layer` / `server` / `serveHttp` are the toolkit runtime verbs (they pull the engine, but only
 *   when actually used — e.g. in a Node entrypoint).
 * - `make` / `Service` / `Schema` / `Errors` / `rateLimiterLayer` are the engine helpers, aliased
 *   from the engine's namespace object (again, only pulled when used).
 *
 * `Tag` is a normal Effect service (`Context.Service` keyed by id) — driven the same `yield* Tag`
 * whether local or remote; only the provided layer differs.
 */
import { QueueResource as engine } from "../QueueResource";

export {
  queueTag as Tag,
  configure,
  layer,
  server,
  serveHttp,
} from "../QueueContract";

export const make = engine.make;
export const Service = engine.Service;
export const Schema = engine.Schema;
export const Errors = engine.Errors;
export const rateLimiterLayer = engine.rateLimiterLayer;
