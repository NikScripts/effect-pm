/**
 * @module examples/last/router-context/lib/AppLayout
 *
 * Layout places composition only — zero HTML.
 */
import { Effect } from "effect";
import * as Layout from "last-ts/Layout";
import * as AppTree from "./AppTree";

export class AppLayout extends Layout.make()(
  "hyperlink-ts/examples/last/router-context/AppLayout",
  Effect.sync(() => <AppTree.AppTree />),
) {}
