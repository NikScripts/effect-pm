/**
 * @module examples/last/router-context/lib/DocsLayout
 *
 * Docs layout — places docs composition only (no HTML).
 */
import { Effect } from "effect";
import * as Layout from "last-ts/Layout";
import * as DocsTree from "./DocsTree";

export class DocsLayout extends Layout.make()(
  "hyperlink-ts/examples/last/router-context/DocsLayout",
  Effect.sync(() => <DocsTree.DocsTree />),
) {}
