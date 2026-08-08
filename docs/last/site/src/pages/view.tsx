import * as Page from "last-ts/Page";
import { ViewDemo } from "../islands/ViewDemo";

class ViewPage extends Page.static() {
  static Component = () => (
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

export default Page.asDefault(ViewPage);
