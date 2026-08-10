"use client";

/**
 * App-owned provider — `Last.provider` + Document cell + Waku transport.
 */
import { Layer, pipe } from "effect";
import * as Last from "last-ts/Last";
import * as Waku from "last-ts/Waku";
import { siteDocumentLayer } from "./document";
import { routes } from "./site";

export const Provider = Last.provider(
  pipe(
    Waku.layer,
    Layer.provide(routes),
    Layer.provide(siteDocumentLayer),
  ),
);
