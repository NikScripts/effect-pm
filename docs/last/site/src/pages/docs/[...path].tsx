/**
 * Plain Waku RSC page — no Page.asDefault / getConfig (banned).
 * See `docs/handoffs/last-ts-api-corrections.md`.
 */
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
