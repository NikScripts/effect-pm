/** RSC page module — registered via `last-ts/server` (dynamic host render). */
export default function DocsPath(props: { readonly path: string }) {
  return (
    <article data-page="docs-path">
      <h1>Docs rest · {props.path}</h1>
      <p>
        File <code>pages/docs/[...path]</code> maps to catalog id{" "}
        <code>docs_path</code>. Soft-nav: <code>urls.docs_path(…)</code>.
      </p>
    </article>
  );
}
