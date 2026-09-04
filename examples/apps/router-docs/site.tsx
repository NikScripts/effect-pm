/**
 * Browser catalog — same destinations as `examples/ui/router-mini-docs.ts`,
 * with {@link Route.handle} so {@link Router.Outlet} can render pages.
 */
import { Schema } from "effect";
import * as Route from "../../../src/ui/Route";

const page = (title: string, body: string) => (
  <article data-page={title}>
    <h1>{title}</h1>
    <p>{body}</p>
  </article>
);

export const site = Route.make("docs").add(
  Route.get("home", "/").pipe(
    Route.handle(() =>
      page("Hyperlink", "Effect services with a real UI router."),
    ),
  ),
  Route.get("intro", "/introduction").pipe(
    Route.handle(() =>
      page("Introduction", "One Tag, one Layer, one Node — then compose."),
    ),
  ),
  Route.get("install", "/getting-started/install").pipe(
    Route.handle(() => page("Install", "pnpm add hyperlink-ts effect")),
  ),
  Route.group("guides").add(
    Route.get("index", "/guides").pipe(
      Route.handle(() =>
        page("Guides", "Work pools, gates, daemons, nodes."),
      ),
    ),
    Route.get("workPools", "/guides/work-pools").pipe(
      Route.handle(() =>
        page("Work pools", "Priority lanes, durable backlog, metrics."),
      ),
    ),
    Route.get("gates", "/guides/gates").pipe(
      Route.handle(() =>
        page("Gates", "Concurrency limits and HTTP client transforms."),
      ),
    ),
  ),
  Route.get("api", "/api/:symbol").pipe(
    Route.params(Schema.Struct({ symbol: Schema.String })),
    Route.handle(({ params }) =>
      page(`API · ${params.symbol}`, `Reference for ${params.symbol}.`),
    ),
  ),
);

export const urls = Route.urlBuilder(site);
