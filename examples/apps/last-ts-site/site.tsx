/**
 * last.ts demo catalog — Router ≈ HttpApi + RouterBuilder handlers.
 */
import * as React from "react";
import { Effect, Layer, Schema } from "effect";
import type { Layout } from "last-ts/Layout";
import * as Last from "last-ts/Last";
import * as History from "last-ts/History";
import * as Page from "last-ts/Page";
import * as Route from "last-ts/Route";
import * as Router from "last-ts/Router";
import * as RouterBuilder from "last-ts/RouterBuilder";
import * as View from "last-ts/View";

// =============================================================================
// View.Service — sidebar slot with optional default
// =============================================================================

export class Sidebar extends View.Service<Sidebar>()(
  "last-ts-site/Sidebar",
  () => (
    <nav data-sidebar="default" className="slot-nav">
      <span className="slot-label">default</span>
      <p>View.Service(key, default)</p>
    </nav>
  ),
) {}

class Shell extends View.Service<Shell>()("last-ts-site/Shell") {
  static layer = Layer.effect(
    Shell,
    Effect.gen(function* () {
      const Side = yield* Sidebar;
      return () => (
        <div data-demo="shell" className="slot-shell">
          <Side />
          <div className="slot-body">Page body</div>
        </div>
      );
    }),
  );
}

class SettingsShell extends View.Service<SettingsShell>()(
  "last-ts-site/SettingsShell",
) {
  static layer = Layer.effect(
    SettingsShell,
    Effect.gen(function* () {
      const Side = yield* Sidebar;
      return () => (
        <div data-demo="settings-shell" className="slot-shell">
          <Side />
          <div className="slot-body">Settings</div>
        </div>
      );
    }).pipe(
      Effect.provideService(Sidebar, () => (
        <nav data-sidebar="settings" className="slot-nav settings">
          <span className="slot-label">override</span>
          <p>Effect.provideService(Sidebar, …)</p>
        </nav>
      )),
    ),
  );
}

const DefaultShell = View.mount(Shell);
const SettingsApp = View.mount(SettingsShell);

const ViewPage = (): React.ReactElement => {
  const [mode, setMode] = React.useState<"default" | "settings">("default");
  const App = mode === "settings" ? SettingsApp : DefaultShell;
  return (
    <article data-page="view">
      <h1>View.Service</h1>
      <p>
        Positional <code>default</code> → <code>Context.Reference</code>. Object
        second arg stays annotations (Prototype).
      </p>
      <div className="toggle">
        <button
          type="button"
          className={mode === "default" ? "on" : undefined}
          onClick={() => setMode("default")}
        >
          default
        </button>
        <button
          type="button"
          className={mode === "settings" ? "on" : undefined}
          onClick={() => setMode("settings")}
        >
          settings override
        </button>
      </div>
      <App />
    </article>
  );
};

// =============================================================================
// Catalog + handlers
// =============================================================================

const RootLayout: Layout = ({ children }) => <>{children}</>;

export class Site extends Router.make("last-ts-site").add(
  Router.group("app", { topLevel: true }).add(
    Route.get("home", "/"),
    Route.get("view", "/view"),
    Route.get("about", "/about"),
    Route.get("chapter", "/guides/:slug", {
      params: { slug: Schema.String },
    }),
  ),
) {}

const homePage = Effect.gen(function* () {
  const req = yield* Page.Request;
  const doc = yield* Page.Document;
  yield* doc.set("last.ts — home");
  return (
    <article data-page="home">
      <h1>last.ts</h1>
      <p>
        Effect + React building blocks — not Hyperlink. Router is HttpApi; page
        routes use Page success.
      </p>
      <dl className="meta">
        <div>
          <dt>Page.Request.pathname</dt>
          <dd>
            <code>{req.pathname}</code>
          </dd>
        </div>
        <div>
          <dt>handler</dt>
          <dd>
            <code>Effect → ReactNode</code>
          </dd>
        </div>
      </dl>
    </article>
  );
});

const aboutPage = (
  <article data-page="about">
    <h1>About</h1>
    <p>
      JSX overload: <code>{`handle("about", <About />)`}</code>
    </p>
    <p>
      Also: <code>View.effect(effect)</code> bakes Effect → component.
    </p>
  </article>
);

const chapterPage = (
  props: RouterBuilder.PageProps<typeof Site, "app", "chapter">,
): React.ReactElement => (
  <article data-page="chapter">
    <h1>Guide · {props.params.slug}</h1>
    <p>
      Params from the endpoint schema — same as HttpApi.
    </p>
  </article>
);

const appGroup = RouterBuilder.group(Site, "app", RootLayout, (h) =>
  h
    .handle("home", homePage)
    .handle("view", ViewPage)
    .handle("about", aboutPage)
    .handle("chapter", chapterPage),
);

export const routes = RouterBuilder.layer(Site).pipe(Layer.provide(appGroup));

/** History transport + RouterBuilder catalog. */
export const provider = Last.provider(
  History.layer.pipe(Layer.provide(routes)),
);

export const urls = Route.urlBuilder(Site);
