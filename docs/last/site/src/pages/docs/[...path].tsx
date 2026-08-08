import { Schema } from "effect";
import * as Page from "last-ts/Page";

const docsPathOptions = {
  params: { path: Schema.String },
} as const;

/**
 * Rest / splat dogfood — disk `[...path]` → route `*path` (`docs_path`).
 * Open-ended splat is dynamic; Waku’s own `getConfig` is engine wire only
 * (not a last-ts API — `createPages` replaces it later).
 */
class DocsPath extends Page.make(docsPathOptions) {
  static Component = (
    props: Page.PropsFromOptions<typeof docsPathOptions>,
  ) => (
    <article data-page="docs-path">
      <h1>Docs rest · {props.params.path}</h1>
      <p>
        File <code>pages/docs/[...path]</code> maps to catalog id{" "}
        <code>docs_path</code> and path <code>/docs/*path</code>. Soft-nav:{" "}
        <code>urls.docs_path(&quot;a/b&quot;)</code>.
      </p>
    </article>
  );
}

export default Page.asDefault(DocsPath);

/** Waku engine config — not Page.*; createPages will replace this later. */
export const getConfig = async () =>
  ({
    render: "dynamic",
  }) as const;
