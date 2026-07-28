import type { MiddlewareHandler } from "hono";

/**
 * Split the public brand host from the docs demo host.
 *
 * - `hyperlink.cool` / `www` — coming-soon only (no docs/API/search surface)
 * - `dev.hyperlink.cool` — full docs site (feedback / demo)
 * - localhost / `*.ondigitalocean.app` — full site (local + DO smokes)
 *
 * Static HTML for `/docs/*` still exists in the image; this gate is what keeps the
 * apex from advertising or serving it.
 */

const PUBLIC_HOSTS = new Set(["hyperlink.cool", "www.hyperlink.cool"]);
const DEMO_HOST = "dev.hyperlink.cool";

const PUBLIC_ALLOW = new Set([
  "/",
  "/favicon.svg",
  "/og.svg",
  "/healthz",
  "/robots.txt",
]);

const isLocalOrOriginPreview = (host: string): boolean =>
  host === "localhost" ||
  host.startsWith("127.0.0.1") ||
  host.endsWith(".ondigitalocean.app");

const hostnameOf = (raw: string): string => {
  const noPort = raw.split(":")[0] ?? raw;
  return noPort.toLowerCase();
};

const publicRobots = `User-agent: *
Allow: /
Disallow: /docs
Disallow: /api
Disallow: /search
Disallow: /releases

# Docs demo lives on ${DEMO_HOST} — not indexed from the brand host.
`;

const publicHostGate = (): MiddlewareHandler => {
  return async (c, next) => {
    const host = hostnameOf(c.req.header("x-forwarded-host") ?? c.req.header("host") ?? "");
    if (host === "" || isLocalOrOriginPreview(host) || host === DEMO_HOST) {
      // Demo host: land in the book, not the coming-soon lockup.
      if (host === DEMO_HOST && (c.req.path === "/" || c.req.path === "")) {
        return c.redirect("/docs/index", 302);
      }
      return next();
    }

    if (!PUBLIC_HOSTS.has(host)) {
      return next();
    }

    const path = c.req.path === "" ? "/" : c.req.path;

    if (path === "/robots.txt") {
      return c.text(publicRobots, 200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      });
    }

    if (PUBLIC_ALLOW.has(path)) {
      return next();
    }

    // Quiet: no docs/API leak from guessed URLs on the brand host.
    return c.redirect("/", 302);
  };
};

export default publicHostGate;
