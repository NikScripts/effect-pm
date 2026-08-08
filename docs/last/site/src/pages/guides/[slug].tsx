import * as Page from "last-ts/Page";
import { chapterOptions } from "../../lib/chapter";

class Chapter extends Page.make(chapterOptions) {
  static Component = (props: Page.PropsFromOptions<typeof chapterOptions>) => (
    <article data-page="chapter">
      <h1>Guide · {props.params.slug}</h1>
      <p>
        Param page under <code>pages/guides/[slug]</code>. Params come from{" "}
        <code>Page.make</code>’s options bag (same as <code>Route.get</code>).
        Soft-nav via <code>urls.chapter(…)</code> from the catalog’s{" "}
        <code>Route.fromPage</code> twin.
      </p>
    </article>
  );
}

export default Page.asDefault(Chapter);
