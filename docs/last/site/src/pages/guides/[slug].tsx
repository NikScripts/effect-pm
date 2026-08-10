/**
 * Path `/guides/[slug]` from this file. Mint has no path.
 * Host `staticPaths` stay on createPages for SSG fan-out.
 */
import { Schema } from "effect";
import * as Page from "last-ts/Page";

export class Chapter extends Page.static(
  {
    params: { slug: Schema.Literals(["routing", "view-service"]) },
  },
  (props: { readonly slug: string }) => (
    <article data-page="chapter">
      <h1>Guide · {props.slug}</h1>
      <p>
        Param page under <code>pages/guides/[slug]</code>. Soft-nav:{" "}
        <code>urls.guides_slug(…)</code>.
      </p>
    </article>
  ),
) {}
