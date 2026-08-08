/**
 * Typed catalog from `paths.gen` + catalog twin pages (client-safe).
 *
 * File pages own RSC render; soft-nav uses {@link Route.fileRootFromPages}
 * so route ids match the file table (`index`, `guides_slug`, …). Chapter
 * params/mode come from the shared options bag (`chapter.ts`) — Provider
 * never imports RSC page modules. Server tooling can mirror with
 * `Router.pagesByIdFromModules(import.meta.glob(…))`.
 */
import { Layer } from "effect";
import type { Layout } from "last-ts/Layout";
import * as Page from "last-ts/Page";
import * as Route from "last-ts/Route";
import * as Router from "last-ts/Router";
import * as RouterBuilder from "last-ts/RouterBuilder";
import { fileEntries } from "../paths.gen";
import { chapterOptions } from "./chapter";

/** Catalog twin of `pages/guides/[slug]` — options SSOT in `chapter.ts`. */
class GuidesSlug extends Page.static(chapterOptions) {}

export class Site extends Router.make("last-ts").add(
  Route.fileRootFromPages(fileEntries, {
    guides_slug: GuidesSlug,
  }),
) {}

export const urls = Route.urlBuilder(Site);

const Passthrough: Layout = ({ children }) => children as never;

/** Catalog + registry for Waku.layer (file routes own page bodies). */
const app = RouterBuilder.group(Site, "root", Passthrough, (h) =>
  h
    .handle("index", () => null)
    .handle("about", () => null)
    .handle("guides_slug", () => null)
    .handle("view", () => null)
    .handle("docs_path", () => null),
);

export const routes = RouterBuilder.layer(Site).pipe(Layer.provide(app));
