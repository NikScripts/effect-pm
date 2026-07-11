// Page footer: previous / next links with the real chapter titles. Server component —
// just links, derived from the flattened book order (crosses group boundaries).

import { prevNext } from "../lib/docs-content.js";

export async function PrevNext({ slug }: { readonly slug: string }) {
  const { prev, next } = await prevNext(slug);
  if (prev === undefined && next === undefined) return null;
  return (
    <nav className="prevnext" aria-label="Previous and next chapter">
      {prev !== undefined ? (
        <a className="prevnext-link prevnext-prev" href={prev.href}>
          <span className="prevnext-dir">← Previous</span>
          <span className="prevnext-title">{prev.title}</span>
        </a>
      ) : (
        <span />
      )}
      {next !== undefined ? (
        <a className="prevnext-link prevnext-next" href={next.href}>
          <span className="prevnext-dir">Next →</span>
          <span className="prevnext-title">{next.title}</span>
        </a>
      ) : (
        <span />
      )}
    </nav>
  );
}
