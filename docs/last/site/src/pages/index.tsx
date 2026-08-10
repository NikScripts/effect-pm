/**
 * Path `/` from this file. Mint has no path.
 */
import * as Page from "last-ts/Page";

export class Home extends Page.static(
  <article data-page="home">
    <h1>last.ts</h1>
    <p>
      Official docs server — last-ts file router + soft-nav via{" "}
      <code>Last.provider</code> / <code>last-ts/Waku</code>.
    </p>
    <dl className="meta">
      <div>
        <dt>catalog</dt>
        <dd>
          <code>Router.make</code> + <code>Route.get</code> (HttpApi lock)
        </dd>
      </div>
      <div>
        <dt>page mint</dt>
        <dd>
          <code>Page.make</code> / <code>Page.static</code> +{" "}
          <code>Route.static</code>
        </dd>
      </div>
      <div>
        <dt>provider</dt>
        <dd>
          <code>export const provider = Last.provider(…)</code>
        </dd>
      </div>
    </dl>
  </article>,
) {}
