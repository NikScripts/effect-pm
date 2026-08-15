/**
 * @module examples/last/context-link/lib/DocsCopy
 *
 * Docs-group content bag — stays off the root Site scope (codesplit shape).
 */
import { Context, Layer } from "effect";

export class DocsCopy extends Context.Service<DocsCopy, {
  readonly sidebarTitle: string;
}>()("hyperlink-ts/examples/last/context-link/lib/DocsCopy") {}

export const layer = Layer.succeed(DocsCopy, { sidebarTitle: "Guides" });
