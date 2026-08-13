/**
 * @module examples/last/context-link/lib/SiteCopy
 *
 * Non-UI content bag — `Context.Service`, not a View.
 */
import { Context, Layer } from "effect";

// ---cut---
export class SiteCopy extends Context.Service<SiteCopy, {
  readonly brand: string;
}>()("hyperlink-ts/examples/last/context-link/lib/SiteCopy") {}

export const layer = Layer.succeed(SiteCopy, { brand: "last.ts" });
