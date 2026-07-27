import type { MiddlewareHandler } from "hono";

/**
 * Edge-cacheable Cache-Control for SSR'd dependency API pages.
 *
 * Effect / platform-node / sql-sqlite-node symbol pages are `render: "dynamic"`
 * (full SSG overflows Waku). DO App Platform often emits `Cache-Control: private`
 * on those responses; Cloudflare Cache Rules for these paths use
 * `edge_ttl.mode = override_origin` so the edge TTL wins. Setting a public
 * `s-maxage` here documents intent and helps any CDN that respects origin.
 *
 * hyperlink-ts API pages are static SSG — leave them alone (and cache via the
 * existing static asset rules / default HTML policy).
 *
 * @see docs/site/deploy/README.md — Cloudflare Cache Rules + purge-on-deploy
 */
const DEP_API_PREFIXES = [
  "/api/effect",
  "/api/platform-node",
  "/api/sql-sqlite-node",
] as const;

const isDepApiPath = (path: string): boolean =>
  DEP_API_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));

// 1 day at shared caches; browsers revalidate sooner. Content only changes on deploy
// (purge clears the edge — see scripts/cf-edge-cache.sh).
const DEP_API_CACHE_CONTROL =
  "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800";

const cacheHeaders = (): MiddlewareHandler => {
  return async (c, next) => {
    await next();
    if (c.req.method !== "GET" && c.req.method !== "HEAD") return;
    if (!isDepApiPath(c.req.path)) return;
    // Only stamp successful HTML/document responses — don't cache error pages long.
    if (c.res.status < 200 || c.res.status >= 400) return;
    c.res.headers.set("Cache-Control", DEP_API_CACHE_CONTROL);
  };
};

export default cacheHeaders;
