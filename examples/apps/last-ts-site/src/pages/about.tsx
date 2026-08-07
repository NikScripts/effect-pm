import * as Page from "last-ts/Page";

function About() {
  return (
    <article data-page="about">
      <h1>About</h1>
      <p>
        <code>{`Page.static("/about", About, { title: "About" })`}</code>
      </p>
      <p>
        File-router / Waku reads the stamp via <code>Page.getConfig</code>{" "}
        today; <code>createPages</code> will read <code>stampOf</code> directly
        later.
      </p>
    </article>
  );
}

const Stamped = Page.static("/about", About, { title: "About" });
export default Stamped;
export const getConfig = Page.getConfig(Stamped);
