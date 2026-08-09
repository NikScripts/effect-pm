/** RSC page module — registered via `last-ts/server` (not Waku fsRouter). */
export default function Home() {
  return (
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
          <dt>view DI</dt>
          <dd>
            <code>View.make</code> + <code>View.mount</code>
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
