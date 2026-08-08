/**
 * Plain Waku RSC page — no Page.asDefault / getConfig (banned).
 * Static vs dynamic is owned by last-ts Route/Page API, not Waku getConfig.
 * See `docs/handoffs/last-ts-api-corrections.md`.
 */
export default function Chapter(props: { readonly slug: string }) {
  return (
    <article data-page="chapter">
      <h1>Guide · {props.slug}</h1>
      <p>
        Param page under <code>pages/guides/[slug]</code>. Soft-nav:{" "}
        <code>urls.guides_slug(…)</code>.
      </p>
    </article>
  );
}
