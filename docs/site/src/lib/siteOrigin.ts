// Absolute site origin for canonical / Open Graph URLs.
// Prefer DOCS_SITE_ORIGIN at build/SSR (deploy stamps it); fall back to production.

export const siteOrigin = (): string =>
  (process.env.DOCS_SITE_ORIGIN ?? "https://hyperlink.cool").replace(/\/$/, "");

export const absoluteUrl = (path: string): string => {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${siteOrigin()}${p}`;
};
