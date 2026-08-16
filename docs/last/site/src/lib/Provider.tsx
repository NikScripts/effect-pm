"use client";

/**
 * App-owned provider — `Last.provider(layer)` only (no second SiteKit arg).
 * Kits mount from router `.context(SiteKit)` under Outlet.
 */
import { Layer, pipe } from "effect";
import * as Last from "last-ts/Last";
import * as Waku from "last-ts/Waku";
import { siteDocumentLayer } from "./document";
import { routes } from "./site";

export const Provider = Last.provider(
  pipe(
    Waku.layer,
    Layer.provideMerge(routes),
    // provideMerge — keep Document.Cell in the Layer output (plain provide drops it)
    Layer.provideMerge(siteDocumentLayer),
  ),
);
