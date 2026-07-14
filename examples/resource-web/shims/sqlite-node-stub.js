// Browser stub for @effect/sql-sqlite-node (Node-only SQLite). This demo's queues are
// in-memory, so the SQLite client is imported-but-never-called; a Proxy no-op satisfies any
// namespace access without dragging Node's fs/util into the client bundle (vite's dev optimizer
// otherwise eagerly bundles better-sqlite3 and the app dies on `promisify is not a function`).
const noop = new Proxy(function () {}, {
  get: () => noop,
  apply: () => noop,
  construct: () => noop,
});
export default noop;
export const SqliteClient = noop;
export const make = noop;
export const layer = noop;
export const layerConfig = noop;
