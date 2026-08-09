/**
 * Host server entry (CLI filename). Routes register through `last-ts/server` —
 * not Waku `fsRouter` / `getConfig`. Page modules under `./pages` are ordinary
 * imports; last-ts `fileRouter` owns the typed path table (`paths.gen.ts`).
 */
import { adapter, createPages } from "last-ts/server";
import About from "./pages/about";
import DocsPath from "./pages/docs/[...path]";
import Chapter from "./pages/guides/[slug]";
import Home from "./pages/index";
import ViewPage from "./pages/view";
import Layout from "./pages/_layout";
import Root from "./pages/_root";

export default adapter(
  createPages(async ({ createPage, createLayout, createRoot }) => [
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
      render: "static",
      path: "/",
      component: Home,
    }),
    createPage({
      render: "static",
      path: "/about",
      component: About,
    }),
    createPage({
      render: "static",
      path: "/view",
      component: ViewPage,
    }),
    createPage({
      render: "static",
      path: "/guides/[slug]",
      component: Chapter,
      staticPaths: ["routing", "view-service"],
    }),
    createPage({
      render: "dynamic",
      path: "/docs/[...path]",
      component: DocsPath,
    }),
  ]),
);
