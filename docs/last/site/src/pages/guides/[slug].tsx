import { Schema } from "effect";
import * as Page from "last-ts/Page";

class Chapter extends Page.make({
  params: { slug: Schema.Literals(["routing", "view-service"]) },
}) {
  static Component = (props: Page.Props<Chapter>) => (
    <article data-page="chapter">
      <h1>Guide · {props.params.slug}</h1>
      <p>
        Param page under <code>pages/guides/[slug]</code>. Params come from{" "}
        <code>Page.make</code>’s options bag (same as <code>Route.get</code>).
        Soft-nav via <code>urls.chapter(…)</code> from the catalog’s{" "}
        <code>Route.staticFromEffect</code> bags.
      </p>
    </article>
  );
}

export default Page.asDefault(Chapter);
