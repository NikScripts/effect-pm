"use client";

/**
 * App-owned provider — `Last.provider` + `last-ts/Waku` (never import `waku`).
 */
import { Layer, pipe } from "effect";
import * as Last from "last-ts/Last";
import * as Waku from "last-ts/Waku";
import { routes } from "./site";

export const Provider = Last.provider(
  pipe(Waku.layer, Layer.provide(routes)),
);
