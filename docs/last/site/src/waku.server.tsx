/**
 * Host server entry (CLI filename). Routes register through `last-ts/server` —
 * not Waku `fsRouter` / `getConfig`. Bake mode + prop adapt via
 * `Server.fromPage(path, mint)`; paths come from the files.
 *
 * Host-only — not product API (see last-ts-spine / last-ts-api-corrections).
 */
import * as Server from "last-ts/server";
import * as About from "./pages/about";
import * as DocsPath from "./pages/docs/[...path]";
import * as Chapter from "./pages/guides/[slug]";
import * as Home from "./pages/index";
import * as ViewPage from "./pages/view";
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
      ...Server.fromPage("/", Home.Home),
    }),
    createPage({
      ...Server.fromPage("/about", About.About),
    }),
    createPage({
      ...Server.fromPage("/view", ViewPage.ViewPage),
    }),
    createPage({
      ...Server.fromPage("/guides/[slug]", Chapter.Chapter),
      staticPaths: ["routing", "view-service"],
    }),
    createPage({
      ...Server.fromPage("/docs/[...path]", DocsPath.DocsPath),
    }),
  ]),
);
