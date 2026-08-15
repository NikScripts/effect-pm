/**
 * @module examples/ui/view-typed-jsx/App
 *
 * Edge — `Last.provide(Tag, constLayer)`. Docs Twoslash + the live island import this file.
 *
 * Docs (Tailscale): http://100.67.32.32:5190/docs/view-typed-jsx
 */
import * as Last from "last-ts/Last";
import { AppRoot, appLayer } from "./lib/AppRoot";

/** Yield* Services in Layers; fulfill the root Tag at the edge. */
export const App = Last.provide(AppRoot, appLayer);

App;
// ^?
