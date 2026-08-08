import * as Page from "last-ts/Page";
import { chapterOptions } from "../../lib/chapter";

/**
 * Static chapter — Literals + `Page.static` → `pageConfig` injects
 * `getConfig` / `staticPaths` (apps never write engine config).
 *
 * Props use {@link Page.PropsFromOptions} inside the class body (avoids a
 * circular `typeof Chapter` on `static Component`). Outside: `Page.Props<typeof Chapter>`.
 */
class Chapter extends Page.static(chapterOptions) {
  static Component = (
    props: Page.PropsFromOptions<typeof chapterOptions>,
  ) => (
    <article data-page="chapter">
      <h1>Guide · {props.params.slug}</h1>
      <p>
        Param page under <code>pages/guides/[slug]</code>. Same options bag as
        the catalog twin (<code>GuidesSlug</code> via{" "}
        <code>Route.fileRootFromPages</code>). Soft-nav:{" "}
        <code>urls.guides_slug(…)</code>.
      </p>
    </article>
  );
}

export default Page.asDefault(Chapter);
