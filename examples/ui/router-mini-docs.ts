/**
 * @module examples/ui/router-mini-docs
 *
 * Mini docs **catalog** on `Route` + `Router` — typed `urlBuilder` / `Router.to`.
 * Browser shell (handles + Outlet): `pnpm run example:apps-router-docs`.
 *
 * Run: `pnpm run example:ui-router-mini-docs`
 * Docs: `docs/examples/ui/router-mini-docs.md` Twoslash-includes this file.
 */

// ---cut---
import { Effect, Schema } from "effect";
import * as Route from "../../src/ui/Route";
import * as Router from "../../src/ui/Router";

/**
 * Docs-shaped catalog — same destinations the browser app mounts with `Route.handle`.
 * Nested `guides` group nests on UrlBuilder; leaf routes sit at the top level.
 */
export const site = Route.make("docs").add(
  Route.get("home", "/"),
  Route.get("intro", "/introduction"),
  Route.get("install", "/getting-started/install"),
  Route.group("guides").add(
    Route.get("index", "/guides"),
    Route.get("workPools", "/guides/work-pools"),
    Route.get("gates", "/guides/gates"),
  ),
  Route.get("api", "/api/:symbol").pipe(
    Route.params(Schema.Struct({ symbol: Schema.String })),
  ),
);

/** Typed URL builder — hover `urls.guides.workPools` in the docs / IDE. */
export const urls = Route.urlBuilder(site);

/** Live router over this catalog (`memory` for CLI; browser app uses `history`). */
export const makeDocsRouter = (
  mode: "memory" | "history" = "memory",
): Router.Service<typeof site> => Router.make(site, mode);

// ---cut-after---
const program = Effect.gen(function* () {
  const router = makeDocsRouter("memory");

  yield* Effect.logInfo("typed urls");
  yield* Effect.logInfo(`  home      ${urls.home()}`);
  yield* Effect.logInfo(`  intro     ${urls.intro()}`);
  yield* Effect.logInfo(`  install   ${urls.install()}`);
  yield* Effect.logInfo(`  guides    ${urls.guides.index()}`);
  yield* Effect.logInfo(`  workPools ${urls.guides.workPools()}`);
  yield* Effect.logInfo(`  gates     ${urls.guides.gates()}`);
  yield* Effect.logInfo(
    `  api       ${urls.api({ params: { symbol: "WorkPool" } })}`,
  );

  router.to((u) => u.guides.workPools());
  yield* Effect.logInfo(
    `match ${String(router.match?.route.identifier)} → ${router.pathname}`,
  );

  router.to((u) => u.api({ params: { symbol: "Route.handle" } }));
  yield* Effect.logInfo(
    `match ${String(router.match?.route.identifier)} → ${router.pathname}`,
  );
  const symbol = router.match?.params["symbol"] ?? "";
  yield* Effect.logInfo(`params.symbol ${symbol}`);
});


void Effect.runPromise(
  program.pipe(
    Effect.tap(() => Effect.logInfo("example:ui-router-mini-docs finished OK")),
  ),
);
