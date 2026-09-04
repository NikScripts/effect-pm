import type { MiddlewareHandler } from "hono";
import { hostnameOf, resolvePublicHostGate } from "../lib/publicHostGate.mjs";

/**
 * Split the public brand host from the docs demo host.
 *
 * - `hyperlink.cool` / `www` — coming-soon only (no docs/API/search surface)
 * - `dev.hyperlink.cool` — full docs site (feedback / demo)
 * - localhost / `*.ondigitalocean.app` — full site (local + DO smokes)
 *
 * Waku mounts `serveStatic` *before* Hono middleware, so this alone does not gate
 * prerendered HTML. Production uses `scripts/serve-production.mjs`, which applies
 * the same {@link resolvePublicHostGate} rules before Waku. Cloudflare Single
 * Redirects remain the edge SSOT (`docs/handoffs/docs-site-dev-host.md`).
 */

const publicHostGate = (): MiddlewareHandler => {
  return async (c, next) => {
    const host = hostnameOf(c.req.header("x-forwarded-host") ?? c.req.header("host") ?? "");
    const path = c.req.path === "" ? "/" : c.req.path;
    const decision = resolvePublicHostGate(host, path);

    if (decision.kind === "robots") {
      return c.text(decision.body, 200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      });
    }

    if (decision.kind === "redirect") {
      return c.redirect(decision.location, decision.status);
    }

    return next();
  };
};

export default publicHostGate;
