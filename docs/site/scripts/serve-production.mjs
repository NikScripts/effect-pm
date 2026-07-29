#!/usr/bin/env node
/**
 * Production entry: host-gate *before* Waku's serveStatic.
 *
 * `waku start` registers serveStatic ahead of src/middleware, so brand-host
 * requests for prerendered `/docs/*` never hit 00-publicHostGate. This wrapper
 * applies the same rules from `src/lib/publicHostGate.mjs`, then delegates.
 *
 * Usage (cwd = docs/site):
 *   node scripts/serve-production.mjs
 *   HOST=0.0.0.0 PORT=8080 node scripts/serve-production.mjs
 */
import { INTERNAL_runFetch, unstable_serverEntry } from "../dist/server/index.js";
import { hostnameOf, resolvePublicHostGate } from "../src/lib/publicHostGate.mjs";

const { serve } = unstable_serverEntry;

const host = process.env.HOST;
const port = process.env.PORT;

/** @param {Request} req */
const gatedFetch = async (req, ...args) => {
  const url = new URL(req.url);
  const hostname = hostnameOf(req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "");
  const decision = resolvePublicHostGate(hostname, url.pathname);

  if (decision.kind === "robots") {
    return new Response(decision.body, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    });
  }

  if (decision.kind === "redirect") {
    return new Response(null, {
      status: decision.status,
      headers: { Location: decision.location },
    });
  }

  return INTERNAL_runFetch(process.env, req, ...args);
};

serve({
  fetch: gatedFetch,
  ...(host ? { hostname: host } : {}),
  ...(port ? { port: parseInt(port, 10) } : {}),
});
