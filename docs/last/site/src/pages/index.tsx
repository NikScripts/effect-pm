import * as Page from "last-ts/Page";

class Home extends Page.static() {
  static Component = () => (
    <article data-page="home">
      <h1>last.ts</h1>
      <p>
        Official docs server — Waku file pages as <code>Page.make</code> /
        <code>Page.static</code> classes, soft-nav via{" "}
        <code>Last.provider(Waku.layer.pipe(Layer.provide(routes)))</code>.
      </p>
      <dl className="meta">
        <div>
          <dt>pages</dt>
          <dd>
            <code>Page.make</code> (dynamic) · <code>Page.static</code> (SSG)
          </dd>
        </div>
        <div>
          <dt>catalog</dt>
          <dd>
            <code>Route.fileRootFromPages</code> + <code>paths.gen</code>
          </dd>
        </div>
        <div>
          <dt>provider</dt>
          <dd>
            <code>export const Provider = Last.provider(…)</code>
          </dd>
        </div>
      </dl>
    </article>
  );
}

export default Page.asDefault(Home);
