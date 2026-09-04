/**
 * Path `/about` — `Page.make` with an Effect body (dynamic bake).
 *
 * `Page.document` needs `Document.Cell` (client Provider / soft-nav Outlet).
 * Host RSC runs Effects via `Effect.runPromise` without pulling client View —
 * title writes stay on soft-nav until a server Document bridge lands.
 */
import { Effect } from "effect";
import * as Page from "last-ts/Page";

export class About extends Page.make(
  Effect.succeed(
    <article data-page="about">
      <h1>About</h1>
      <p>
        <code>Page.make(Effect)</code> body — host runs it with{" "}
        <code>Effect.runPromise</code> (no client <code>View.effect</code>).
      </p>
    </article>,
  ),
) {}
