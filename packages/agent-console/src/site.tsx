/**
 * Catalog — home (repo/worktree browsing), setup, a repo's session list,
 * and one session's chat. Navigation goes through `router.go(urls...)`
 * wrapped in `navigateWithTransition` (viewTransition.ts) rather than
 * `Router.link`, since the View Transitions API needs an imperative hook
 * around the DOM update — see Home.tsx / SessionChat.tsx.
 *
 * @internal
 */
import { Schema } from "effect";
import * as Route from "last-ts/Route";
import { Home } from "./pages/Home";
import { RepoSessions } from "./pages/RepoSessions";
import { Settings } from "./pages/Settings";
import { Setup } from "./pages/Setup";
import { SessionChat } from "./pages/SessionChat";

export const site = Route.make("agent-console").add(
  Route.get("sessions", "/").pipe(Route.handle(() => <Home />)),
  Route.get("setup", "/setup").pipe(Route.handle(() => <Setup />)),
  Route.get("settings", "/settings").pipe(Route.handle(() => <Settings />)),
  Route.get("repo", "/repo/:name").pipe(
    Route.params(Schema.Struct({ name: Schema.String })),
    Route.handle(({ params }) => <RepoSessions name={params.name} />),
  ),
  Route.get("session", "/session/:id").pipe(
    Route.params(Schema.Struct({ id: Schema.String })),
    Route.handle(({ params }) => <SessionChat id={params.id} />),
  ),
);

export const urls = Route.urlBuilder(site);
