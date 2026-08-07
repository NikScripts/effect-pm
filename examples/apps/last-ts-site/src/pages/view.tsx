import { ViewDemo } from "../islands/ViewDemo.js";

export default function ViewPage() {
  return (
    <article data-page="view">
      <h1>View.Service</h1>
      <p>
        Server page shell; interactive slot lives in a client island. Positional{" "}
        <code>default</code> → <code>Context.Reference</code>.
      </p>
      <ViewDemo />
    </article>
  );
}
