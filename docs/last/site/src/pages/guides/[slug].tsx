import * as Page from "last-ts/Page";
import { chapterBags, chapterOptions } from "../../lib/chapter";

/**
 * Static chapter — Literals + `Page.static`. Param SSG needs Waku’s own
 * `getConfig` / `staticPaths` on this file (engine wire — not a last-ts API;
 * `createPages` replaces it later).
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

/** Waku engine config — not Page.*; createPages will replace this later. */
export const getConfig = async () =>
  ({
    render: "static",
    staticPaths: chapterBags.map((bag) => bag.slug),
  }) as const;
