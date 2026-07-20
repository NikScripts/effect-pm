// Browser stub for @effect/platform-node (Node-only platform). Resource.ts reaches it only
// through DYNAMIC import() on node-transport paths that a browser can never take (the http
// transport DIES in a browser by design, and demo islands use in-memory resources) — but
// bundlers chase dynamic imports, so without this stub the client build tries to bundle
// node:fs/node:http/node:worker_threads. A Proxy no-op satisfies any namespace access; if a
// browser path ever actually CALLS into it, failing loudly here beats a phantom bundle.
const noop = new Proxy(function () {}, {
  get: () => noop,
  apply: () => noop,
  construct: () => noop,
});
export default noop;
export const NodeSocket = noop;
export const NodeServices = noop;
export const NodeHttpServer = noop;
export const NodeHttpClient = noop;
export const NodeRuntime = noop;
