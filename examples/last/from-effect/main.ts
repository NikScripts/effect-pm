/**
 * @module examples/last/from-effect
 *
 * NEW showcase: Context-backed `group.fromEffect` + catalog `groupsFromEffect`.
 *
 * Why this cannot be static `.add`:
 * - Partner ids/slugs/components come from {@link PartnerDirectory} (Layer-swapped).
 * - Entire billing/support **groups** appear only when {@link FeatureModules} says so.
 * A hand-written `.add(Route.get("acme"), …)` couples the catalog to one Layer’s data.
 *
 * Run: `pnpm run example:last-from-effect`
 */

import { Context, Effect, Layer, ManagedRuntime, pipe } from "effect";
import * as React from "react";
import * as Last from "last-ts/Last";
import * as Layout from "last-ts/Layout";
import * as Memory from "last-ts/Memory";
import * as Route from "last-ts/Route";
import * as Router from "last-ts/Router";
import * as RouterBuilder from "last-ts/RouterBuilder";

// =============================================================================
// Domain services (unknown at catalog authoring time)
// =============================================================================

export type Partner = {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  /** Distinct page per partner — not one shared `:slug` switch. */
  readonly Page: React.FC;
};

export class PartnerDirectory extends Context.Service<
  PartnerDirectory,
  { readonly partners: ReadonlyArray<Partner> }
>()("@example/last/from-effect/PartnerDirectory") {}

export class FeatureModules extends Context.Service<
  FeatureModules,
  { readonly billing: boolean; readonly support: boolean }
>()("@example/last/from-effect/FeatureModules") {}

const page = (label: string, testId: string): React.FC => {
  const Comp: React.FC = () =>
    React.createElement("section", { "data-page": testId }, label);
  Comp.displayName = label;
  return Comp;
};

/** Demo tenants — two partners, billing only. */
export const layerDemo = Layer.mergeAll(
  Layer.succeed(PartnerDirectory, {
    partners: [
      {
        id: "acme",
        slug: "acme",
        title: "Acme",
        Page: page("Acme microsite", "acme"),
      },
      {
        id: "nova",
        slug: "nova",
        title: "Nova",
        Page: page("Nova microsite", "nova"),
      },
    ],
  }),
  Layer.succeed(FeatureModules, { billing: true, support: false }),
);

/** Enterprise — third partner + support group unlocked. */
export const layerEnterprise = Layer.mergeAll(
  Layer.succeed(PartnerDirectory, {
    partners: [
      {
        id: "acme",
        slug: "acme",
        title: "Acme",
        Page: page("Acme microsite", "acme"),
      },
      {
        id: "globex",
        slug: "globex",
        title: "Globex",
        Page: page("Globex microsite", "globex"),
      },
      {
        id: "initech",
        slug: "initech",
        title: "Initech",
        Page: page("Initech microsite", "initech"),
      },
    ],
  }),
  Layer.succeed(FeatureModules, { billing: true, support: true }),
);

// =============================================================================
// Catalog — fromEffect / groupsFromEffect (flat groups only)
// =============================================================================

const partnersGroup = Route.group("partners")
  .prefix("/p")
  .fromEffect(
    Effect.gen(function* () {
      const { partners } = yield* PartnerDirectory;
      return partners.map((p) =>
        Route.get(p.id, `/${p.slug}`).pipe(Route.handle(() =>
          React.createElement(p.Page),
        )),
      );
    }),
  );

/**
 * Soft-nav catalog. Partner endpoints and optional product groups are Effect
 * derived — the same definition serves demo vs enterprise Layers.
 */
export const Site = Router.make("from-effect-demo")
  .add(Route.get("home", "/"), partnersGroup)
  .groupsFromEffect(
    Effect.gen(function* () {
      const mods = yield* FeatureModules;
      const groups: Array<Route.GroupTop> = [];
      if (mods.billing) {
        groups.push(
          Route.group("billing")
            .add(
              Route.get("plans", "/plans").pipe(
                Route.handle(() =>
                  React.createElement("h1", { "data-page": "plans" }, "Plans"),
                ),
              ),
              Route.get("invoices", "/invoices").pipe(
                Route.handle(() =>
                  React.createElement(
                    "h1",
                    { "data-page": "invoices" },
                    "Invoices",
                  ),
                ),
              ),
            )
            .prefix("/billing"),
        );
      }
      if (mods.support) {
        groups.push(
          Route.group("support")
            .add(
              Route.get("tickets", "/tickets").pipe(
                Route.handle(() =>
                  React.createElement(
                    "h1",
                    { "data-page": "tickets" },
                    "Tickets",
                  ),
                ),
              ),
            )
            .prefix("/support"),
        );
      }
      return groups;
    }),
  );

// =============================================================================
// Builder + layout + Memory + Last.provider
// =============================================================================

const home = pipe(
  RouterBuilder.group(Site, "__top", (h) =>
    h.handle("home", () =>
      React.createElement("h1", { "data-page": "home" }, "Home"),
    ),
  ),
  Layout.provide(Layout.Passthrough),
);

/** Empty builder bag — partner handlers ride on `Route.handle` inside fromEffect. */
const partners = pipe(
  RouterBuilder.group(Site, "partners", (h) => h),
  Layout.provide(Layout.Passthrough),
);

export const routesFor = (
  domain: Layer.Layer<PartnerDirectory | FeatureModules>,
) =>
  pipe(
    RouterBuilder.layer(Site),
    Layer.provide(Layer.mergeAll(home, partners)),
    Layer.provide(domain),
  );

export const appLayer = (
  domain: Layer.Layer<PartnerDirectory | FeatureModules>,
) => pipe(Memory.layer, Layer.provide(routesFor(domain)));

/** Full provider bake (demo domain) — same shape as spine `Last.provider`. */
export const Provider = Last.provider(appLayer(layerDemo));

// =============================================================================
// CLI: prove Layer swap changes the live route table
// =============================================================================

const describe = (router: Router.Service) => {
  const groups = Object.keys(router.api.groups).sort();
  const partnerRoutes = Object.keys(
    router.api.groups["partners"]?.routes ?? {},
  ).sort();
  return { groups, partnerRoutes, match: router.match?.route.identifier };
};

const exercise = (label: string) =>
  Effect.gen(function* () {
    const router = yield* Router.Router;
    yield* Effect.logInfo(`── ${label} ──`);
    yield* Effect.logInfo(`groups: ${describe(router).groups.join(", ")}`);
    yield* Effect.logInfo(
      `partners: ${describe(router).partnerRoutes.join(", ") || "(none)"}`,
    );

    router.go("/p/acme");
    yield* Effect.logInfo(`go /p/acme → ${describe(router).match}`);

    router.go("/billing/plans");
    yield* Effect.logInfo(`go /billing/plans → ${describe(router).match}`);

    router.go("/support/tickets");
    yield* Effect.logInfo(
      `go /support/tickets → ${describe(router).match ?? "no match"}`,
    );
  });

const runDomain = async (
  label: string,
  domain: Layer.Layer<PartnerDirectory | FeatureModules>,
): Promise<void> => {
  const rt = ManagedRuntime.make(appLayer(domain));
  try {
    await rt.runPromise(exercise(label));
  } finally {
    await rt.dispose();
  }
};

void (async () => {
  await Effect.runPromise(
    Effect.logInfo(
      "example:last-from-effect — Context-backed fromEffect / groupsFromEffect",
    ),
  );
  await runDomain("demo (acme,nova · billing)", layerDemo);
  await runDomain(
    "enterprise (acme,globex,initech · billing+support)",
    layerEnterprise,
  );
  await Effect.runPromise(
    Effect.logInfo("Provider bake ok: " + typeof Provider),
  );
  await Effect.runPromise(
    Effect.logInfo("example:last-from-effect finished OK"),
  );
})();
