/**
 * @module examples/last/context-link/lib/AppLayout
 *
 * Layout places composition only — zero HTML.
 */
import * as React from "react";
import { Effect } from "effect";
import * as Layout from "last-ts/Layout";
import * as Tree from "./Tree";

export class AppLayout extends Layout.make()(
  "hyperlink-ts/examples/last/context-link/AppLayout",
  Effect.sync(() => <Tree.Tree />),
) {}
