// Per-page <head> metadata — React 19 hoists title/meta rendered anywhere into the head, so
// pages call this once with their real title/summary and search engines and link unfurlers get
// per-page descriptions instead of the layout's site-wide one.

import { absoluteUrl } from "../lib/siteOrigin.js";

const clamp = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export const PageMeta = ({
  title,
  description,
  path,
  noIndex = false,
}: {
  readonly title: string;
  readonly description: string;
  /** Site-relative path for canonical + og:url (e.g. `/docs/install`). */
  readonly path?: string;
  /** Soft-404 and similar pages that must not enter the index. */
  readonly noIndex?: boolean;
}) => {
  // summaries arrive as markdown-ish text — a meta tag wants none of the markers
  const desc = clamp(description.replace(/[`*_]/g, "").trim(), 200);
  const url = path !== undefined ? absoluteUrl(path) : undefined;
  const ogImage = absoluteUrl("/og.svg");
  return (
    <>
      <title>{title}</title>
      {desc !== "" ? <meta name="description" content={desc} /> : null}
      {noIndex ? <meta name="robots" content="noindex, follow" /> : null}
      {url !== undefined ? <link rel="canonical" href={url} /> : null}
      <meta property="og:title" content={title} />
      {desc !== "" ? <meta property="og:description" content={desc} /> : null}
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content="Hyperlink" />
      {url !== undefined ? <meta property="og:url" content={url} /> : null}
      <meta property="og:image" content={ogImage} />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      {desc !== "" ? <meta name="twitter:description" content={desc} /> : null}
      <meta name="twitter:image" content={ogImage} />
    </>
  );
};
