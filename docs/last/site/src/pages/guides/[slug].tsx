/**
 * RSC page module — registered via `last-ts/server` (staticPaths there).
 * Soft-nav catalog: `urls.guides_slug` on `last-ts` Router.
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
