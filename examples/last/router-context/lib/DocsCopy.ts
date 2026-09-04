/**
 * @module examples/last/router-context/lib/DocsCopy
 *
 * Docs-group content — only required on `/docs/*`.
 */
import { Context, Layer } from "effect";

export class DocsCopy extends Context.Service<DocsCopy, {
  readonly sidebarTitle: string;
}>()("hyperlink-ts/examples/last/router-context/lib/DocsCopy") {}

export const layer = Layer.succeed(DocsCopy, { sidebarTitle: "Guides" });
