"use client";

/**
 * App-owned provider — `Last.provider(Waku.layer.pipe(Layer.provide(routes)))`.
 */
import { Layer } from "effect";
import * as Last from "last-ts/Last";
import * as Waku from "last-ts/Waku";
import { routes } from "./site";

export const Provider = Last.provider(
  Waku.layer.pipe(Layer.provide(routes)),
);
