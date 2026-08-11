/**
 * Host server entry (CLI filename). `Server.fromPage(path, mint)` only.
 */
import * as Server from "last-ts/server";
import { About } from "./pages/about";
import { Chapter } from "./pages/guides/[slug]";
import { Home } from "./pages/index";
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
      ...Server.fromPage("/", Home),
    }),
    createPage({
      ...Server.fromPage("/about", About),
    }),
    createPage({
      ...Server.fromPage("/guides/[slug]", Chapter),
      staticPaths: ["routing", "provider"],
    }),
  ]),
);
