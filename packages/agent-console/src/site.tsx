/**
 * Catalog — two routes: the session list and one session's chat. Navigation
 * goes through `router.go(urls...)` wrapped in `navigateWithTransition`
 * (viewTransition.ts) rather than `Router.link`, since the View Transitions
 * API needs an imperative hook around the DOM update — see SessionList.tsx /
 * SessionChat.tsx.
 *
 * @internal
 */
import { Schema } from "effect";
import * as Route from "last-ts/Route";
import { SessionChat } from "./pages/SessionChat";
import { SessionList } from "./pages/SessionList";

export const site = Route.make("agent-console").add(
  Route.get("sessions", "/").pipe(Route.handle(() => <SessionList />)),
  Route.get("session", "/session/:id").pipe(
    Route.params(Schema.Struct({ id: Schema.String })),
    Route.handle(({ params }) => <SessionChat id={params.id} />),
  ),
);

export const urls = Route.urlBuilder(site);
