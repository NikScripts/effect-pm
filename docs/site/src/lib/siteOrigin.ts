// Absolute site origin for canonical / Open Graph URLs.
// Prefer DOCS_SITE_ORIGIN at build/SSR (deploy stamps it); fall back to production.
// Reject ciphertext / junk — a bare `waku build` without dotenvx once baked
// `encrypted:…` into every canonical and og:image on production.

const DEFAULT_ORIGIN = "https://hyperlink.cool";

const isHttpOrigin = (value: string): boolean => {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
};

export const siteOrigin = (): string => {
  const raw = (process.env.DOCS_SITE_ORIGIN ?? "").trim().replace(/\/$/, "");
  if (raw !== "" && isHttpOrigin(raw)) return raw;
  return DEFAULT_ORIGIN;
};

export const absoluteUrl = (path: string): string => {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${siteOrigin()}${p}`;
};
