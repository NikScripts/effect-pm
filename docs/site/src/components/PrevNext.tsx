// Page footer: previous / next links with the real chapter titles. Soft-nav via Router.Link —
// hrefs from the flattened book order (crosses group boundaries).

import { prevNext } from "../lib/docs-content.js";
import * as Router from "../ui/Router.js";

export async function PrevNext({ slug }: { readonly slug: string }) {
  const { prev, next } = await prevNext(slug);
  if (prev === undefined && next === undefined) return null;
  return (
    <nav className="prevnext" aria-label="Previous and next chapter">
      {prev !== undefined ? (
        <Router.Link className="prevnext-link prevnext-prev" to={prev.href}>
          <span className="prevnext-dir">← Previous</span>
          <span className="prevnext-title">{prev.title}</span>
        </Router.Link>
      ) : (
        <span />
      )}
      {next !== undefined ? (
        <Router.Link className="prevnext-link prevnext-next" to={next.href}>
          <span className="prevnext-dir">Next →</span>
          <span className="prevnext-title">{next.title}</span>
        </Router.Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
