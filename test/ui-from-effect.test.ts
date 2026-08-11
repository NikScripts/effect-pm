/**
 * Context-backed `group.fromEffect` + `groupsFromEffect` — destinations only
 * exist after Layer provides domain services (not static `.add`).
 */
import { describe, expect, it } from "@effect/vitest";
import { Context, Effect, Layer, ManagedRuntime, pipe } from "effect";
import * as React from "react";
import * as Layout from "last-ts/Layout";
import * as Memory from "last-ts/Memory";
import * as Route from "last-ts/Route";
import * as Router from "last-ts/Router";
import * as RouterBuilder from "last-ts/RouterBuilder";

class Plugins extends Context.Service<
  Plugins,
  {
    readonly items: ReadonlyArray<{
      readonly id: string;
      readonly path: `/${string}`;
    }>;
  }
>()("test/from-effect/Plugins") {}

class Modules extends Context.Service<
  Modules,
  { readonly admin: boolean }
>()("test/from-effect/Modules") {}

const pluginsGroup = Route.group("plugins")
  .prefix("/x")
  .fromEffect(
    Effect.gen(function* () {
      const { items } = yield* Plugins;
      return items.map((p) =>
        Route.get(p.id, p.path).pipe(
          Route.handle(() =>
            React.createElement("span", { "data-id": p.id }, p.id),
          ),
        ),
      );
    }),
  );

const Site = Router.make("from-effect-test")
  .add(Route.get("home", "/"), pluginsGroup)
  .groupsFromEffect(
    Effect.gen(function* () {
      const { admin } = yield* Modules;
      if (!admin) return [];
      return [
        Route.group("admin")
          .add(
            Route.get("users", "/users").pipe(
              Route.handle(() =>
                React.createElement("span", { "data-id": "users" }, "users"),
              ),
            ),
          )
          .prefix("/admin"),
      ];
    }),
  );

const home = pipe(
  RouterBuilder.group(Site, "__top", (h) =>
    h.handle("home", () => React.createElement("h1", null, "home")),
  ),
  Layout.provide(Layout.Passthrough),
);

const plugins = pipe(
  RouterBuilder.group(Site, "plugins", (h) => h),
  Layout.provide(Layout.Passthrough),
);

const app = (domain: Layer.Layer<Plugins | Modules>) =>
  pipe(
    Memory.layer,
    Layer.provide(
      pipe(
        RouterBuilder.layer(Site),
        Layer.provide(Layer.mergeAll(home, plugins)),
        Layer.provide(domain),
      ),
    ),
  );

describe("group.fromEffect + groupsFromEffect (Context)", () => {
  it("materializes partner endpoints from the Layer-provided service", async () => {
    const domain = Layer.mergeAll(
      Layer.succeed(Plugins, {
        items: [
          { id: "charts", path: "/charts" },
          { id: "reports", path: "/reports" },
        ],
      }),
      Layer.succeed(Modules, { admin: false }),
    );
    const rt = ManagedRuntime.make(app(domain));
    try {
      await rt.runPromise(
        Effect.gen(function* () {
          const router = yield* Router.Router;
          expect(Object.keys(router.api.groups["plugins"]!.routes).sort()).toEqual(
            ["charts", "reports"],
          );
          expect(router.api.groups["admin"]).toBeUndefined();
          router.go("/x/charts");
          expect(router.match?.route.identifier).toBe("charts");
        }),
      );
    } finally {
      await rt.dispose();
    }
  });

  it("groupsFromEffect adds a top-level group only when the flag is on", async () => {
    const domain = Layer.mergeAll(
      Layer.succeed(Plugins, { items: [{ id: "a", path: "/a" }] }),
      Layer.succeed(Modules, { admin: true }),
    );
    const rt = ManagedRuntime.make(app(domain));
    try {
      await rt.runPromise(
        Effect.gen(function* () {
          const router = yield* Router.Router;
          expect(router.api.groups["admin"]).toBeDefined();
          router.go("/admin/users");
          expect(router.match?.route.identifier).toBe("users");
        }),
      );
    } finally {
      await rt.dispose();
    }
  });

  it("keeps eager fromEffect (R=never) for sync lists", () => {
    const g = Route.group("sync").fromEffect(
      Effect.succeed([Route.get("one", "/one"), Route.get("two", "/two")]),
    );
    expect(Object.keys(g.routes).sort()).toEqual(["one", "two"]);
  });
});
