/**
 * Path `/` from this file. Mint has no path.
 */
import * as Page from "last-ts/Page";

export class Home extends Page.static(
  <article data-page="home">
    <h1>last.ts</h1>
    <p>
      Product site — leaf HTML in <code>ui/*</code> via{" "}
      <code>View.make</code>; <code>Tree</code> / <code>Frame</code> compose with
      zero DOM.
    </p>
    <p>
      Soft-nav: <code>Site.context(SiteKit)</code> +{" "}
      <code>Last.provideContext</code> + <code>Last.provider</code>.
    </p>
    <dl className="meta">
      <div>
        <dt>leaf HTML</dt>
        <dd>
          <code>ui/Site</code> · <code>NavBar</code> · <code>Sidebar</code> ·{" "}
          <code>Main</code> · <code>Footer</code> · <code>LayoutGrid</code>
        </dd>
      </div>
      <div>
        <dt>composition</dt>
        <dd>
          <code>lib/Tree</code> + <code>Frame.App</code> (
          <code>Last.use(SiteKit)</code>)
        </dd>
      </div>
      <div>
        <dt>live DI demo</dt>
        <dd>
          <a href="/view">/view</a> — <code>View.make</code> + slot override
        </dd>
      </div>
    </dl>
  </article>,
) {}
