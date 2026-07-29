/**
 * @module Observe
 *
 * Unbound Effect-reactive **recipes** and **packs**, discharged with `bind` / `use`.
 *
 * - Constructors (`atom` / `query` / `fn` / `scan` / `fold` / `poll`) build recipes.
 * - `struct` / `merge` / `and` compose packs.
 * - `bind(runtime)(tag, pack)` / `use(tag, pack)` attach a Tag under an `Atom.AtomRuntime`
 *   (`use` reads `RuntimeProvider`).
 *
 * Shipped family packs live on service `*View` modules (e.g. `WorkPoolView.pack`).
 *
 * @example
 * ```ts
 * import * as Observe from "hyperlink-ts/Observe"
 * import * as WorkPoolView from "hyperlink-ts/ui/WorkPoolView"
 *
 * const box = Observe.use(Jobs, WorkPoolView.pack)
 * ```
 *
 * @since 0.9.0
 */
export {
  and,
  atom,
  bind,
  fn,
  fold,
  map,
  merge,
  named,
  packOf,
  poll,
  query,
  recipe,
  scan,
  struct,
  type AtomTag,
  type BindContext,
  type BoundOf,
  type FoldOptions,
  type Pack,
  type Recipe,
  type ScanOptions,
} from "./internal/observe";

export { use } from "./internal/observeUse";

export declare namespace Observe {
  export type Recipe<Svc, Out> = import("./internal/observe").Recipe<Svc, Out>;
  export type Pack<Svc, Out extends object> =
    import("./internal/observe").Pack<Svc, Out>;
  export type BoundOf<R> = import("./internal/observe").BoundOf<R>;
}
