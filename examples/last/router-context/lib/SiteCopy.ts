/**
 * @module examples/last/router-context/lib/SiteCopy
 *
 * Root content bag — thin on purpose (size lock).
 */
import { Context, Layer } from "effect";

export class SiteCopy extends Context.Service<SiteCopy, {
  readonly brand: string;
}>()("hyperlink-ts/examples/last/router-context/lib/SiteCopy") {}

export const layer = Layer.succeed(SiteCopy, { brand: "last.ts" });
