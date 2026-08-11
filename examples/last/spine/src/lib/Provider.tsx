"use client";

/**
 * One Last.provider bake — transport + routes + Document cell.
 */
import { Layer, pipe } from "effect";
import * as Last from "last-ts/Last";
import * as Waku from "last-ts/Waku";
import { spineDocumentLayer } from "./document";
import { routes } from "./site";

export const Provider = Last.provider(
  pipe(
    Waku.layer,
    Layer.provide(routes),
    // provideMerge — keep Document.Cell in the Layer output (plain provide drops it)
    Layer.provideMerge(spineDocumentLayer),
  ),
);
