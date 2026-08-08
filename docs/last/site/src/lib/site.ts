/**
 * Typed catalog — file pages own RSC render; urls.* for soft-nav.
 *
 * Bare endpoints land on the synthetic `__top` group (type + runtime), so
 * `RouterBuilder.group(Site, "__top", …)` matches and `urls.*` stay flat.
 *
 * Chapter params/mode come from the same options bag as the file page
 * (`chapterOptions`) via {@link Route.fromPage} — no RSC import into Provider.
 */
import { Layer } from "effect";
import type { Layout } from "last-ts/Layout";
import * as Page from "last-ts/Page";
import * as Route from "last-ts/Route";
import * as Router from "last-ts/Router";
import * as RouterBuilder from "last-ts/RouterBuilder";
import { chapterOptions } from "./chapter";

/** Catalog twin of `pages/guides/[slug]` — options SSOT in `chapter.ts`. */
class ChapterRoute extends Page.static(chapterOptions) {}

export class Site extends Router.make("last-ts").add(
  Route.get("home", "/"),
  Route.get("view", "/view"),
  Route.get("about", "/about"),
  Route.fromPage("chapter", "/guides/:slug", ChapterRoute),
) {}

export const urls = Route.urlBuilder(Site);

const Passthrough: Layout = ({ children }) => children as never;

/** Catalog + registry for Waku.layer (file routes own page bodies). */
const app = RouterBuilder.group(Site, "__top", Passthrough, (h) =>
  h
    .handle("home", () => null)
    .handle("view", () => null)
    .handle("about", () => null)
    .handle("chapter", () => null),
);

export const routes = RouterBuilder.layer(Site).pipe(Layer.provide(app));
