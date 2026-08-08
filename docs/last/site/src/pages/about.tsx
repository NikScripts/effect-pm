import * as Page from "last-ts/Page";

class About extends Page.static() {
  static Component = () => (
    <article data-page="about">
      <h1>About</h1>
      <p>
        File pages are classes — <code>Page.make</code> /{" "}
        <code>Page.static</code> — not Services. Waku’s default export is{" "}
        <code>Page.asDefault(…)</code> so the class brand stays for{" "}
        <code>Page.extract</code>. Apps never write <code>getConfig</code>.
      </p>
    </article>
  );
}

export default Page.asDefault(About);
