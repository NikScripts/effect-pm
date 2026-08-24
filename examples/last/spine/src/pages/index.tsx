/**
 * Path `/` from this file. Mint has no path.
 */
import * as Page from "last-ts/Page";

export class Home extends Page.static(
  <article data-page="home">
    <h1>last-ts spine</h1>
    <p>
      Acceptance demo — <code>Page.make</code> / catalog /{" "}
      <code>Document.provide</code> / <code>Last.provider</code>.
    </p>
  </article>,
) {}
