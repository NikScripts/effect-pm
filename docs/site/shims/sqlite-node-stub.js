// Browser stub for @effect/sql-sqlite-node (Node-only SQLite). A demo queue is
// in-memory, so this is imported-but-never-called; a Proxy no-op satisfies any
// namespace access without dragging Node's fs/util into the client bundle.
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
