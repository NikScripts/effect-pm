/**
 * Path `/guides/[slug]` from this file. Mint has no path.
 * Host `staticPaths` stay on createPages for SSG fan-out.
 * Props are soft-nav shaped (`params`); `Server.fromPage` adapts Waku flats.
 */
import { Schema } from "effect";
import * as Page from "last-ts/Page";

export class Chapter extends Page.static(
  {
    params: { slug: Schema.Literals(["routing", "view-service"]) },
  },
  (props: { readonly params: { readonly slug: string } }) => (
    <article data-page="chapter">
      <h1>Guide · {props.params.slug}</h1>
      <p>
        Param page under <code>pages/guides/[slug]</code>. Soft-nav:{" "}
        <code>urls.guides_slug(…)</code>.
      </p>
    </article>
  ),
) {}
