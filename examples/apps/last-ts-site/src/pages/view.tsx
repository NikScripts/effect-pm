import * as Page from "last-ts/Page";
import { ViewDemo } from "../islands/ViewDemo.js";

function ViewPage() {
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

const Stamped = Page.static("/view", ViewPage, { title: "View.Service" });
export default Stamped;
export const getConfig = Page.getConfig(Stamped);
