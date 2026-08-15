/**
 * @module examples/last/context-link/lib/DocsLayout
 *
 * Docs layout — places docs composition only (no HTML).
 */
import * as React from "react";
import { Effect } from "effect";
import * as Layout from "last-ts/Layout";
import * as DocsTree from "./DocsTree";

export class DocsLayout extends Layout.make()(
  "hyperlink-ts/examples/last/context-link/DocsLayout",
  Effect.sync(() => <DocsTree.DocsTree />),
) {}
