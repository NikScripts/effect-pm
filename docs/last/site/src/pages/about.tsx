/**
 * Path `/about` from this file. Mint has no path.
 */
import * as Page from "last-ts/Page";

export class About extends Page.static(
  <article data-page="about">
    <h1>About</h1>
    <p>last.ts docs surface — not Hyperlink docs/site.</p>
  </article>,
) {}
