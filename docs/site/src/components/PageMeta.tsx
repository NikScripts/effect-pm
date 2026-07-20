// Per-page <head> metadata — React 19 hoists title/meta rendered anywhere into the head, so
// pages call this once with their real title/summary and search engines and link unfurlers get
// per-page descriptions instead of the layout's site-wide one.

const clamp = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export const PageMeta = ({
  title,
  description,
}: {
  readonly title: string;
  readonly description: string;
}) => {
  // summaries arrive as markdown-ish text — a meta tag wants none of the markers
  const desc = clamp(description.replace(/[`*_]/g, "").trim(), 200);
  return (
    <>
      <title>{title}</title>
      {desc !== "" ? <meta name="description" content={desc} /> : null}
      <meta property="og:title" content={title} />
      {desc !== "" ? <meta property="og:description" content={desc} /> : null}
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content="effect-pm" />
      <meta name="twitter:card" content="summary" />
    </>
  );
};
