/**
 * Brand host vs docs demo host — shared by Hono middleware and the production
 * serve entry (which runs *before* Waku's serveStatic, so static HTML is gated too).
 *
 * Keep allowlists in sync with Cloudflare Single Redirects
 * (`docs/handoffs/docs-site-dev-host.md`): never block `/assets/*`.
 */

export const PUBLIC_HOSTS = new Set(["hyperlink.cool", "www.hyperlink.cool"]);
export const DEMO_HOST = "dev.hyperlink.cool";

export const PUBLIC_ALLOW = new Set([
  "/",
  "/favicon.svg",
  "/og.svg",
  "/healthz",
  "/robots.txt",
]);

export const publicRobots = `User-agent: *
Allow: /
Disallow: /docs
Disallow: /api
Disallow: /search
Disallow: /releases

# Docs demo lives on ${DEMO_HOST} (not indexed from the brand host).
`;

/** @param {string} host */
export const isLocalOrOriginPreview = (host) =>
  host === "localhost" ||
  host.startsWith("127.0.0.1") ||
  host.endsWith(".ondigitalocean.app");

/** @param {string} raw */
export const hostnameOf = (raw) => {
  const noPort = raw.split(":")[0] ?? raw;
  return noPort.toLowerCase();
};

/**
 * @param {string} host
 * @param {string} path
 * @returns
 *   | { kind: "pass" }
 *   | { kind: "redirect"; location: string; status: number }
 *   | { kind: "robots"; body: string }
 */
export const resolvePublicHostGate = (host, path) => {
  const normalizedPath = path === "" ? "/" : path;

  if (host === "" || isLocalOrOriginPreview(host)) {
    return { kind: "pass" };
  }

  if (host === DEMO_HOST) {
    if (normalizedPath === "/") {
      return { kind: "redirect", location: "/docs/index", status: 302 };
    }
    return { kind: "pass" };
  }

  if (!PUBLIC_HOSTS.has(host)) {
    return { kind: "pass" };
  }

  if (normalizedPath === "/robots.txt") {
    return { kind: "robots", body: publicRobots };
  }

  // Coming-soon lockup + fingerprinted assets (inlined CSS still hydrates JS).
  if (
    PUBLIC_ALLOW.has(normalizedPath) ||
    normalizedPath.startsWith("/assets/")
  ) {
    return { kind: "pass" };
  }

  return { kind: "redirect", location: "/", status: 302 };
};
