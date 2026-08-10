/**
 * Path `/view` from this file. Mint has no path.
 */
import * as Page from "last-ts/Page";
import { ViewDemo } from "../islands/ViewDemo";

export class ViewPage extends Page.static(() => (
  <article data-page="view">
    <h1>View.make</h1>
    <p>
      DI components via <code>View.make</code> + <code>View.mount</code>. Swap
      slots with <code>Effect.provideService</code> / Layer provide.
    </p>
    <ViewDemo />
  </article>
)) {}
