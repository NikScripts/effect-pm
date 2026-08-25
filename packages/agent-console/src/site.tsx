/**
 * Catalog — two routes for phase 1: the session list and one session's chat.
 *
 * @internal
 */
import { Schema } from "effect";
import * as Route from "last-ts/Route";
import * as Router from "last-ts/Router";
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

export const Link = Router.link(site);
