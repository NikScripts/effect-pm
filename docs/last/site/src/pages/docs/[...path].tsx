/**
 * Path `/docs/[...path]` from this file — dynamic bake (`Page.make`).
 * Props are soft-nav shaped (`params.path` string splat); host adapts Waku.
 */
import { Schema } from "effect";
import * as Page from "last-ts/Page";

export class DocsPath extends Page.make(
  { params: { path: Schema.String } },
  (props: { readonly params: { readonly path: string } }) => (
    <article data-page="docs-path">
      <h1>Docs rest · {props.params.path}</h1>
      <p>
        File <code>pages/docs/[...path]</code> maps to catalog id{" "}
        <code>docs_path</code>. Soft-nav: <code>urls.docs_path(…)</code>.
      </p>
    </article>
  ),
) {}
