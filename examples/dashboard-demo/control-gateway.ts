/**
 * Minimal same-origin control gateway (forwards `/api/control` → private ControlService).
 *
 * Run when you are not using the Vite dev proxy:
 * `pnpm run example:dashboard-demo:gateway`
 *
 * Serves UI separately (for example `vite`) with `baseUrl` `/api/control` aimed at this host.
 */

import { createServer, request as httpRequest } from "node:http";

const pmOrigin = process.env["PM_CONTROL_URL"] ?? "http://127.0.0.1:3001";
const gatewayPort = Number(process.env["GATEWAY_PORT"] ?? 3100);
const prefix = "/api/control";

const forward = (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => {
  if (req.url === undefined || !req.url.startsWith(prefix)) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: false, error: "Not found" }));
    return;
  }

  const targetPath = req.url.slice(prefix.length) || "/";
  const targetUrl = new URL(targetPath, pmOrigin);

  const proxyReq = httpRequest(
    targetUrl,
    {
      method: req.method,
      headers: {
        ...req.headers,
        host: targetUrl.host,
      },
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on("error", (error) => {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: false, error: String(error) }));
  });

  req.pipe(proxyReq);
};

createServer(forward).listen(gatewayPort, () => {
  console.log(
    `Control gateway http://127.0.0.1:${String(gatewayPort)}${prefix} → ${pmOrigin}`,
  );
});
