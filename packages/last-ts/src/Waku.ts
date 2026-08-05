/**
 * @module Waku
 *
 * Waku location transport — own namespace because of the `waku` peer
 * (`History` / `Memory` stay on lite modules).
 *
 * Prefer {@link layer} with {@link ./RouterBuilder} + {@link ./Last.provider}.
 * Lower-level binding helpers re-export from the former `Router/waku` entry.
 *
 * @public
 */
"use client";

export {
  waku,
  layer as binding,
  setDefault,
  isWakuBinding,
  router,
  Provider,
  useRouter,
  useHasRouter,
  useMatch,
  Link,
  type WakuBinding,
} from "./Router/waku";

import { Effect, Layer } from "effect";
import * as Router from "./Router";
import * as routerBuilder from "./internal/routerBuilder";
import * as wakuInternal from "./internal/routerWaku";

/**
 * Waku engine Layer — requires catalog + handlers; adapts Waku’s client router.
 * Must render under Waku’s router tree.
 *
 * @public
 */
export const layer: Layer.Layer<
  Router.Router,
  never,
  routerBuilder.Catalog | routerBuilder.Handlers
> = Layer.effect(
  Router.Router,
  Effect.gen(function* () {
    const api = yield* routerBuilder.Catalog;
    const handlers = yield* routerBuilder.Handlers;
    const binding = wakuInternal.waku(api);
    // Service is completed in React via Waku hooks; expose catalog shell for types.
    const base = {
      api,
      _tag: "Waku" as const,
      pathname: "/",
      search: "",
      href: "/",
      match: undefined,
      urls: binding.urls,
      go: () => undefined,
      to: () => undefined,
      back: () => undefined,
      toRoot: () => undefined,
      prefetch: () => undefined,
      subscribe: () => () => undefined,
      syncFromLocation: () => undefined,
      _handlers: handlers,
    };
    return base as Router.Service;
  }),
);
