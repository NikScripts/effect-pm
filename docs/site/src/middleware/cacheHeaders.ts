import type { MiddlewareHandler } from "hono";

/**
 * Cache-Control for responses DigitalOcean often wraps as `private`.
 *
 * Cloudflare Cache Rules for matching paths use `edge_ttl.mode = override_origin`
 * so the edge TTL wins even when DO rewrites headers — but a correct origin
 * `Cache-Control` still helps browsers, any CDN that respects origin, and
 * Lighthouse's "efficient cache lifetimes" audit.
 *
 * @see docs/site/scripts/cf-edge-cache.sh
 * @see docs/site/deploy/README.md
 */

/** SSR'd dependency API pages (too heavy for full SSG). */
const DEP_API_PREFIXES = [
  "/api/effect",
  "/api/platform-node",
  "/api/sql-sqlite-node",
] as const;

/** Fingerprinted Vite/Waku build output — content-addressed; safe for long TTL. */
const isHashedAsset = (path: string): boolean =>
  path.startsWith("/assets/") && /-[A-Za-z0-9_-]{6,}\.(js|css|woff2?|svg|png|jpg|webp)$/.test(path);

/** Search / llms / sitemap corpus — regenerated only on deploy. */
const isDeployStaticData = (path: string): boolean =>
  path.startsWith("/search/") ||
  path === "/llms.txt" ||
  path === "/llms-full.txt" ||
  path === "/sitemap.xml" ||
  path === "/favicon.svg" ||
  path === "/og.svg" ||
  path === "/robots.txt" ||
  path === "/healthz";

const isDepApiPath = (path: string): boolean =>
  DEP_API_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));

// Shared caches 1 day; browsers 5 min. Purge-on-deploy clears the edge.
const SHARED_DAY =
  "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800";
// Hashed assets: year + immutable (filename changes on content change).
const IMMUTABLE_YEAR = "public, max-age=31536000, immutable";

const cacheHeaders = (): MiddlewareHandler => {
  return async (c, next) => {
    await next();
    if (c.req.method !== "GET" && c.req.method !== "HEAD") return;
    if (c.res.status < 200 || c.res.status >= 400) return;

    const path = c.req.path;
    if (isHashedAsset(path)) {
      c.res.headers.set("Cache-Control", IMMUTABLE_YEAR);
      return;
    }
    if (isDepApiPath(path) || isDeployStaticData(path)) {
      c.res.headers.set("Cache-Control", SHARED_DAY);
    }
  };
};

export default cacheHeaders;
