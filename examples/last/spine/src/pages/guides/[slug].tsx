/**
 * Path `/guides/[slug]`. Props are soft-nav shaped; host adapts Waku flats.
 */
import { Schema } from "effect";
import * as Page from "last-ts/Page";

export class Chapter extends Page.static(
  {
    params: { slug: Schema.Literals(["routing", "provider"]) },
  },
  (props: { readonly params: { readonly slug: string } }) => (
    <article data-page="chapter">
      <h1>Guide · {props.params.slug}</h1>
      <p>
        Nested <code>params.slug</code> — soft-nav and RSC share one shape.
      </p>
    </article>
  ),
) {}
