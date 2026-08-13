/**
 * @module examples/last/router-context/lib/routes
 *
 * Handlers + Layout.provide + Last.contextProvide (builder debt).
 */
import * as React from "react";
import { Layer, pipe } from "effect";
import * as Last from "last-ts/Last";
import * as Layout from "last-ts/Layout";
import * as RouterBuilder from "last-ts/RouterBuilder";
import * as App from "./App";
import * as AppLayout from "./AppLayout";
import * as DocsCopy from "./DocsCopy";
import * as DocsKit from "./DocsKit";
import * as DocsLayout from "./DocsLayout";
import * as Site from "./Site";
import * as SiteCopy from "./SiteCopy";

const Home = (): React.ReactElement => <p data-page="home">home</p>;
const About = (): React.ReactElement => <p data-page="about">about</p>;
const DocsIndex = (): React.ReactElement => <p data-page="docs">docs</p>;
const Chapter = (props: {
  readonly params: { readonly slug: string };
}): React.ReactElement => (
  <p data-page="chapter">chapter: {props.params.slug}</p>
);

const main = pipe(
  RouterBuilder.group(App.App, "main", (h) =>
    h.handle("home", Home).handle("about", About),
  ),
  Layout.provide(AppLayout.AppLayout),
);

const docs = pipe(
  RouterBuilder.group(App.App, "docs", (h) =>
    h.handle("index", DocsIndex).handle("chapter", Chapter),
  ),
  Layout.provide(DocsLayout.DocsLayout),
  Last.contextProvide(DocsKit.DocsKit, DocsCopy.layer),
);

/**
 * Root `.context(Site)` — Views use Reference defaults; copy is Layer-provided.
 * `provideMerge` keeps group kit services (e.g. DocsCopy) in the runtime Context.
 */
export const routes = pipe(
  RouterBuilder.layer(App.App),
  Layer.provideMerge(Layer.mergeAll(main, docs)),
  Last.contextProvide(Site.Site, SiteCopy.layer),
);
