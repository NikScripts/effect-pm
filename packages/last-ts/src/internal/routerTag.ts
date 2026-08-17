/**
 * Router Context.Service tag — separate from {@link ../Router} React bindings so
 * {@link ../Link} can `yield*` without a circular import.
 *
 * @internal
 */
import { Context } from "effect";
import type { Service } from "./router";

/** @internal */
export class Router extends Context.Service<Router, Service>()(
  "last-ts/internal/routerTag/Router",
) {}
