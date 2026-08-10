/**
 * Host server entry (CLI filename). Routes register through `last-ts/server` —
 * not Waku `fsRouter` / `getConfig`. Bake mode + prop adapt via
 * `Server.fromPage(path, mint)`; paths come from the files.
 *
 * `(book)` stays a literal path segment here (not stripped) so Waku's own
 * layout matching attaches `(book)/_layout` to every book route — see
 * `create-pages.js`'s `getLayouts` (matches path *prefixes*, groups included).
 * The last-ts file router / `paths.gen.ts` strip `(book)` for the app-level
 * typed catalog (`lib/siteRoutes.ts`) since it never appears in served URLs.
 */
import { runServer } from "./lib/runtime.js";
import { packages, symbolPaths } from "./lib/api-data.js";
import { chapters } from "./lib/content.js";
import * as Server from "last-ts/server";

import { Home } from "./pages/index";
import { NotFoundPage } from "./pages/(book)/404";
import { ApiIndexPage } from "./pages/(book)/api/index";
import { ApiPackagePage } from "./pages/(book)/api/[pkg]/index";
import { ApiModulePage } from "./pages/(book)/api/[pkg]/[module]/index";
import { ApiSymbolDynamicPage } from "./pages/(book)/api/[pkg]/[module]/[symbol]";
import { HyperlinkSymbolPage } from "./pages/(book)/api/hyperlink-ts/[module]/[symbol]";
import { ChapterPage } from "./pages/(book)/docs/[chapter]";
import { HyperlinksRedirectPage } from "./pages/(book)/docs/hyperlinks";
import { ResourcesRedirectPage } from "./pages/(book)/docs/resources";
import { ReleasesPage } from "./pages/(book)/releases";
import { SearchResultsPage } from "./pages/(book)/search";

import Root from "./pages/_root";
import RootLayout from "./pages/_layout";
import BookLayout from "./pages/(book)/_layout";

const DEV = import.meta.env.DEV;

export default Server.adapter(
  Server.createPages(async ({ createPage, createLayout, createRoot }) => {
    createRoot({
      render: "static",
      component: Root,
    });

    if (DEV) {
      createLayout({ path: "/", render: "dynamic", component: RootLayout });
      createLayout({ path: "/(book)", render: "dynamic", component: BookLayout });
    } else {
      createLayout({ path: "/", render: "static", component: RootLayout });
      createLayout({ path: "/(book)", render: "static", component: BookLayout });
    }

    // ----- Landing (outside the book group) -----
    createPage({
      ...Server.fromPage("/", Home),
    });

    // ----- Book: static-always -----
    createPage({
      ...Server.fromPage("/(book)/404", NotFoundPage),
    });
    createPage({
      ...Server.fromPage("/(book)/docs/hyperlinks", HyperlinksRedirectPage),
    });
    createPage({
      ...Server.fromPage("/(book)/docs/resources", ResourcesRedirectPage),
    });
    createPage({
      ...Server.fromPage("/(book)/search", SearchResultsPage),
    });

    // ----- Book: always dynamic (never pre-rendered — see the page file) -----
    createPage({
      ...Server.fromPage("/(book)/api/[pkg]/[module]/[symbol]", ApiSymbolDynamicPage),
    });

    // ----- Book: always static + staticPaths -----
    createPage({
      ...Server.fromPage("/(book)/api/hyperlink-ts/[module]/[symbol]", HyperlinkSymbolPage),
      staticPaths: (await runServer(symbolPaths()))
        .filter(([p]) => p === "hyperlink-ts")
        .map(([, m, sym]) => [m, sym] as const),
    });

    // ----- Book: DEV-dynamic / prod-static (+ staticPaths in prod only) -----
    if (DEV) {
      createPage({ ...Server.fromPage("/(book)/api", ApiIndexPage), render: "dynamic" });
      createPage({ ...Server.fromPage("/(book)/api/[pkg]", ApiPackagePage), render: "dynamic" });
      createPage({
        ...Server.fromPage("/(book)/api/[pkg]/[module]", ApiModulePage),
        render: "dynamic",
      });
      createPage({ ...Server.fromPage("/(book)/docs/[chapter]", ChapterPage), render: "dynamic" });
      createPage({ ...Server.fromPage("/(book)/releases", ReleasesPage), render: "dynamic" });
    } else {
      createPage({ ...Server.fromPage("/(book)/api", ApiIndexPage), render: "static" });
      createPage({
        ...Server.fromPage("/(book)/api/[pkg]", ApiPackagePage),
        render: "static",
        staticPaths: (await runServer(packages())).map((p) => p.slug),
      });
      createPage({
        ...Server.fromPage("/(book)/api/[pkg]/[module]", ApiModulePage),
        render: "static",
        staticPaths: (await runServer(packages())).flatMap((p) =>
          p.modules.map((m) => [p.slug, m.slug] as const),
        ),
      });
      createPage({
        ...Server.fromPage("/(book)/docs/[chapter]", ChapterPage),
        render: "static",
        staticPaths: chapters.map((c) => c.slug),
      });
      createPage({ ...Server.fromPage("/(book)/releases", ReleasesPage), render: "static" });
    }

    return [];
  }),
);
