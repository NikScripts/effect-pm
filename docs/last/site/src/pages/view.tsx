import { ViewDemo } from "../islands/ViewDemo";

/** Plain Waku RSC page hosting the View.make dogfood island. */
export default function ViewPage() {
  return (
    <article data-page="view">
      <h1>View.make</h1>
      <p>
        DI components via <code>View.make</code> + <code>View.mount</code>. Swap
        slots with <code>Effect.provideService</code> / Layer provide.
      </p>
      <ViewDemo />
    </article>
  );
}
