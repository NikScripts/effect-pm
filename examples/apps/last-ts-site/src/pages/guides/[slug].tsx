import { Effect } from "effect";
import * as Page from "last-ts/Page";

const guides = ["routing", "view-service"] as const;

function Chapter(props: { readonly slug: string }) {
  return (
    <article data-page="chapter">
      <h1>Guide · {props.slug}</h1>
      <p>
        <code>{`Page.build("/guides/:slug", …, { paths })`}</code> — dynamic in
        DEV, staticPaths in production.
      </p>
    </article>
  );
}

const Stamped = Page.build("/guides/:slug", Chapter, {
  title: "Guide",
  paths: Effect.succeed([...guides]),
});

export default Stamped;
export const getConfig = Page.getConfig(Stamped);
