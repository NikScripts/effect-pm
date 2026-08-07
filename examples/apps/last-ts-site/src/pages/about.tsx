export default function About() {
  return (
    <article data-page="about">
      <h1>About</h1>
      <p>
        Plain Waku RSC page. File routes own render; the Router catalog owns
        typed urls. <code>Page.Service</code> / <code>createPages</code> will
        stamp modules later — no <code>Page.getConfig</code>, no Stamped
        theater.
      </p>
    </article>
  );
}
