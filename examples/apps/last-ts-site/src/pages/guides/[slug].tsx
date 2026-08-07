const guides = ["routing", "view-service"] as const;

export default function Chapter(props: { readonly slug: string }) {
  const known = (guides as ReadonlyArray<string>).includes(props.slug);
  return (
    <article data-page="chapter">
      <h1>Guide · {props.slug}</h1>
      <p>
        Param RSC page under <code>pages/guides/[slug]</code>. Soft-nav via{" "}
        <code>urls.chapter(…)</code> from the catalog.
      </p>
      {!known ? (
        <p className="meta">Unknown slug — try routing or view-service.</p>
      ) : null}
    </article>
  );
}
