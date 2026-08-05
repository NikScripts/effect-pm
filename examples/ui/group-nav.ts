/**
 * @module examples/ui/group-nav
 *
 * Group tree → typed catalog (`Group.asRoutes`) + {@link GroupNav} over a lite
 * Memory router. Prints Target `_tag` / `viewOf` / `memberOf` for each step.
 *
 * Run: `pnpm run example:ui-group-nav`
 * Docs: `docs/examples/ui/ui-group-nav.md`
 */

// ---cut---
import { Effect } from "effect";
import * as Daemon from "../../src/Daemon";
import * as Group from "../../src/Group";
import * as GroupNav from "../../src/ui/GroupNav";
import * as Route from "../../src/ui/Route";
import * as Router from "../../src/ui/Router";

class HttpApi extends Daemon.Service<HttpApi>()("examples/group-nav/HttpApi") {}
class Nwsl extends Group.Service<Nwsl>("examples/group-nav/Nwsl")({ HttpApi }) {}
class Hub extends Group.Service<Hub>("examples/group-nav/Hub")({ Nwsl }) {}

/** Catalog generated from the Group — health + leaf logs/schedule included. */
export const site = Route.make("hub").add(
  Route.group("tree", { topLevel: true }).fromEffect(Group.asRoutes(Hub)),
);

export const urls = Route.urlBuilder(site);

/** Lite Memory router — live field is `router._tag`, not a separate mode. */
export const makeHubRouter = (): Router.Service<typeof site> =>
  Router.unsafeService(site, "Memory");

// ---cut-after---
const describeTarget = (router: Router.Service): string => {
  const target = Route.targetOf(router.match);
  if (target === undefined) return "none";
  return [
    `_tag=${target._tag}`,
    `view=${Route.viewOf(target) ?? "—"}`,
    `member=${Route.memberOf(target) === null ? "null" : "leaf"}`,
  ].join(" ");
};

const program = Effect.gen(function* () {
  const router = makeHubRouter();
  yield* Effect.logInfo(`engine ${router._tag}`);

  GroupNav.openKey(Hub, router, "Nwsl");
  yield* Effect.logInfo(
    `group  ${router.pathname} · ${describeTarget(router)}`,
  );

  GroupNav.open(Hub, router, HttpApi);
  yield* Effect.logInfo(
    `leaf   ${router.pathname} · ${describeTarget(router)}`,
  );

  GroupNav.openLogs(Hub, router, HttpApi);
  yield* Effect.logInfo(
    `logs   ${router.pathname} · ${describeTarget(router)}`,
  );

  GroupNav.openSchedule(Hub, router, HttpApi);
  yield* Effect.logInfo(
    `sched  ${router.pathname} · ${describeTarget(router)}`,
  );

  GroupNav.openHealth(router);
  yield* Effect.logInfo(
    `health ${router.pathname} · ${describeTarget(router)}`,
  );

  yield* Effect.logInfo(`urls.Nwsl.HttpApi() → ${urls.Nwsl.HttpApi()}`);
  yield* Effect.logInfo(`urls.health() → ${urls.health()}`);
});

void Effect.runPromise(
  program.pipe(
    Effect.tap(() => Effect.logInfo("example:ui-group-nav finished OK")),
  ),
);
