import * as Page from "last-ts/Page";

function Home() {
  return (
    <article data-page="home">
      <h1>last.ts</h1>
      <p>
        RSC demo — Waku file pages stamped with <code>Page.static</code> /
        <code>Page.build</code>. Not Hyperlink docs.
      </p>
      <dl className="meta">
        <div>
          <dt>render</dt>
          <dd>
            <code>Page.static("/", …)</code> → Waku RSC / SSG
          </dd>
        </div>
        <div>
          <dt>soft-nav</dt>
          <dd>
            <code>last-ts/Router/waku</code> Link (client island in layout)
          </dd>
        </div>
        <div>
          <dt>interactive DI</dt>
          <dd>
            <code>View.Service</code> client island on <code>/view</code>
          </dd>
        </div>
      </dl>
    </article>
  );
}

const Stamped = Page.static("/", Home, { title: "last.ts" });
export default Stamped;
export const getConfig = Page.getConfig(Stamped);
