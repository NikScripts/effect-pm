/**
 * @module examples/last/from-effect
 *
 * Groups from Effect into a normal Router catalog — typed for links.
 *
 * - `group.fromEffect` — destinations (ids stay on UrlBuilder)
 * - `groupsFromEffect` — whole flat groups
 * - Bake `R` (SiteMode | FeatureModules) shows on `RouterBuilder.layer`
 *
 * Run: `pnpm run example:last-from-effect`
 */

import { Context, Effect, Layer, ManagedRuntime, Schema, pipe } from "effect";
import * as React from "react";
import * as Last from "last-ts/Last";
import * as Layout from "last-ts/Layout";
import * as Memory from "last-ts/Memory";
import * as Route from "last-ts/Route";
import * as Router from "last-ts/Router";
import * as RouterBuilder from "last-ts/RouterBuilder";

// =============================================================================
// Domain SSOT — Layer-swappable (not a list of Route.get)
// =============================================================================

export class SiteMode extends Context.Service<
  SiteMode,
  { readonly tenancy: "org" | "single" }
>()("hyperlink-ts/examples/last/from-effect/main/SiteMode") {}

export class FeatureModules extends Context.Service<
  FeatureModules,
  { readonly billing: boolean; readonly support: boolean }
>()("hyperlink-ts/examples/last/from-effect/main/FeatureModules") {}

export const layerOrg = Layer.mergeAll(
  Layer.succeed(SiteMode, { tenancy: "org" }),
  Layer.succeed(FeatureModules, { billing: true, support: false }),
);

export const layerSingle = Layer.mergeAll(
  Layer.succeed(SiteMode, { tenancy: "single" }),
  Layer.succeed(FeatureModules, { billing: true, support: true }),
);

// =============================================================================
// Groups FROM Effect → Router.make().add (catalog only — no handlers here)
// =============================================================================

/** Org-scoped project — 2 params, nested placement. */
const projectOrg = Route.get("project", "/o/:org/projects/:id", {
  params: { org: Schema.String, id: Schema.String },
});

/** Single-tenant project — 1 param. */
const projectSingle = Route.get("project", "/projects/:id", {
  params: { id: Schema.String },
});

/**
 * One group: path grammar extrapolated from SiteMode.
 * Both branches keep identifier `project` for UrlBuilder; runtime shape follows Layer.
 */
const app = Route.group("app").fromEffect(
  Effect.gen(function* () {
    const mode = yield* SiteMode;
    return mode.tenancy === "org"
      ? ([projectOrg] as const)
      : ([projectSingle] as const);
  }),
);

const featureGroups = Effect.gen(function* () {
  const mods = yield* FeatureModules;
  const groups = [];
  if (mods.billing) {
    // Handle on the destination — these groups are not on Site.groups until
    // resolve, so RouterBuilder.group(Site, "billing") cannot run at define time.
    groups.push(
      Route.group("billing").add(
        Route.get("plans", "/billing/plans").pipe(
          Route.handle(() =>
            React.createElement("h1", { "data-page": "plans" }, "Plans"),
          ),
        ),
        Route.get("invoice", "/billing/invoices/:id", {
          params: { id: Schema.String },
        }).pipe(
          Route.handle(() =>
            React.createElement("h1", { "data-page": "invoice" }, "Invoice"),
          ),
        ),
      ),
    );
  }
  if (mods.support) {
    groups.push(
      Route.group("support").add(
        Route.get("tickets", "/support/tickets").pipe(
          Route.handle(() =>
            React.createElement("h1", { "data-page": "tickets" }, "Tickets"),
          ),
        ),
        Route.get("ticket", "/support/tickets/:id", {
          params: { id: Schema.String },
        }).pipe(
          Route.handle(() =>
            React.createElement("h1", { "data-page": "ticket" }, "Ticket"),
          ),
        ),
      ),
    );
  }
  return groups;
});

/** Catalog value — groups from Effect, not Effect→Router. */
export const Site = Router.make("from-effect-demo")
  .add(Route.get("home", "/"), app)
  .groupsFromEffect(featureGroups);

/**
 * Typed link surface — identifiers from fromEffect / groupsFromEffect Items.
 * Runtime hrefs: `router.urls` after Layer bake (needs SiteMode in scope).
 */
export type Urls = Route.UrlBuilder<typeof Site>;

// =============================================================================
// Builder — handlers + layout (separate from catalog Effects)
// =============================================================================

const home = pipe(
  RouterBuilder.group(Site, "__top", (h) =>
    h.handle("home", () =>
      React.createElement("h1", { "data-page": "home" }, "Home"),
    ),
  ),
  Layout.provide(Layout.Passthrough),
);

const appHandlers = pipe(
  RouterBuilder.group(Site, "app", (h) =>
    h.handle("project", () =>
      React.createElement("h1", { "data-page": "project" }, "Project"),
    ),
  ),
  Layout.provide(Layout.Passthrough),
);

export const routesFor = (
  domain: Layer.Layer<SiteMode | FeatureModules>,
) =>
  pipe(
    RouterBuilder.layer(Site), // R includes SiteMode | FeatureModules
    Layer.provide(Layer.mergeAll(home, appHandlers, domain)),
  );

export const appLayer = (
  domain: Layer.Layer<SiteMode | FeatureModules>,
) => pipe(Memory.layer, Layer.provide(routesFor(domain)));

export const Provider = Last.provider(appLayer(layerOrg));

// =============================================================================
// CLI — Layer swap changes live grammar + which groups exist
// =============================================================================

const exercise = (label: string) =>
  Effect.gen(function* () {
    const router = yield* Router.Router;
    const urls = router.urls as Urls;
    const projectPath =
      router.api.groups["app"]?.routes["project"]?.path ?? "";
    yield* Effect.logInfo(`── ${label} ──`);
    yield* Effect.logInfo(
      `groups: ${Object.keys(router.api.groups).sort().join(", ")}`,
    );
    yield* Effect.logInfo(`project path: ${projectPath}`);

    if (projectPath.includes(":org")) {
      const href = urls.app.project("acme", "42");
      router.go(href);
      yield* Effect.logInfo(
        `urls.app.project("acme","42") → ${href} → ${router.match?.route.identifier}`,
      );
    } else {
      const href = urls.app.project("42");
      router.go(href);
      yield* Effect.logInfo(
        `urls.app.project("42") → ${href} → ${router.match?.route.identifier}`,
      );
    }

    router.go(urls.billing.plans());
    yield* Effect.logInfo(
      `urls.billing.plans() → ${router.match?.route.identifier}`,
    );

    router.go("/support/tickets");
    yield* Effect.logInfo(
      `go /support/tickets → ${router.match?.route.identifier ?? "no match"}`,
    );
  });

const runDomain = (label: string, domain: Layer.Layer<SiteMode | FeatureModules>) =>
  Effect.gen(function* () {
    const rt = ManagedRuntime.make(appLayer(domain));
    yield* Effect.promise(() => rt.runPromise(exercise(label)));
    yield* Effect.promise(() => rt.dispose());
  });

void Effect.runPromise(
  Effect.gen(function* () {
    yield* Effect.logInfo(
      "example:last-from-effect — groups from Effect, typed urls, Layer R",
    );
    yield* runDomain("org + billing", layerOrg);
    yield* runDomain("single + billing + support", layerSingle);
    yield* Effect.logInfo("Provider bake ok: " + typeof Provider);
    yield* Effect.logInfo("example:last-from-effect finished OK");
  }),
);
