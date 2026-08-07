export default function Home() {
  return (
    <article data-page="home">
      <h1>last.ts</h1>
      <p>
        RSC demo — Waku file pages + Router catalog soft-nav. Not Hyperlink
        docs.
      </p>
      <dl className="meta">
        <div>
          <dt>render</dt>
          <dd>
            Waku <code>src/pages/**</code> (RSC / SSG)
          </dd>
        </div>
        <div>
          <dt>soft-nav</dt>
          <dd>
            <code>Last.provider(Waku.fromApi(Site))</code>
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
