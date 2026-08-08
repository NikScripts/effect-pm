/**
 * Route.fromEffect / staticFromEffect — literal bags fill params Type.
 */
import { Effect } from "effect";
import { expectTypeOf } from "vitest";
import * as Route from "last-ts/Route";

const rows = Effect.succeed([
  { slug: "routing" as const },
  { slug: "view-service" as const },
]);

const chapter = Route.get("chapter", "/guides/:slug").pipe(
  Route.fromEffect(rows),
);

const baked = Route.get("chapter", "/guides/:slug").pipe(
  Route.staticFromEffect(rows),
);

expectTypeOf(chapter).toMatchTypeOf<Route.Constraint>();
expectTypeOf(baked).toMatchTypeOf<Route.Constraint>();
