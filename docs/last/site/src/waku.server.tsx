/**
 * Host server entry (CLI filename). Routes register through `last-ts/server` —
 * not Waku `fsRouter` / `getConfig`. Bake mode comes from Page mints via
 * `Server.fromPage`; paths come from the files.
 */
import * as Server from "last-ts/server";
import { About } from "./pages/about";
import { DocsPath } from "./pages/docs/[...path]";
import { Chapter } from "./pages/guides/[slug]";
import { Home } from "./pages/index";
import { ViewPage } from "./pages/view";
import Layout from "./pages/_layout";
import Root from "./pages/_root";

export default Server.adapter(
  Server.createPages(async ({ createPage, createLayout, createRoot }) => [
    createRoot({
      render: "static",
      component: Root,
    }),
    createLayout({
      render: "static",
      path: "/",
      component: Layout,
    }),
    createPage({
      path: "/",
      ...Server.fromPage(Home),
    }),
    createPage({
      path: "/about",
      ...Server.fromPage(About),
    }),
    createPage({
      path: "/view",
      ...Server.fromPage(ViewPage),
    }),
    createPage({
      path: "/guides/[slug]",
      ...Server.fromPage(Chapter),
      staticPaths: ["routing", "view-service"],
    }),
    createPage({
      path: "/docs/[...path]",
      ...Server.fromPage(DocsPath),
    }),
  ]),
);
