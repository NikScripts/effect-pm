/**
 * @module examples/last/context-link/lib/Provider
 *
 * One edge bake — no `Last.provider(layer, Site)`; scopes mount from the router.
 */
import { Layer, pipe } from "effect";
import * as Last from "last-ts/Last";
import * as Memory from "last-ts/Memory";
import { routes } from "./routes";

/** `provideMerge` keeps kit services from `Last.provideContext` in the runtime Context. */
export const Provider = Last.provider(
  pipe(Memory.layer, Layer.provideMerge(routes)),
);
