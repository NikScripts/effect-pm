/**
 * @module examples/last/context-link/lib/Provider
 *
 * One edge bake — Layer (transport + routes + copy) + nested `Site` context.
 */
import { Layer, pipe } from "effect";
import * as Last from "last-ts/Last";
import * as Memory from "last-ts/Memory";
import * as Site from "./Site";
import * as SiteCopy from "./SiteCopy";
import { routes } from "./routes";

export const Provider = Last.provider(
  pipe(
    Memory.layer,
    Layer.provide(routes),
    Layer.provideMerge(SiteCopy.layer),
  ),
  Site.Site,
);
