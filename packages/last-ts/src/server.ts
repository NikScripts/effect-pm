/**
 * @module server
 *
 * **Host-only** RSC façade — monorepo Waku entries (`docs/last/site`, spine).
 * Not a package `exports` subpath; apps do not import this. Waku stays inside
 * last-ts so app code never `import`s from `waku/*`.
 *
 * @internal
 */
export { createPages } from "waku/router/server";
export { default as adapter } from "waku/adapters/default";
export { fromPage, type HostPage } from "./internal/hostPage";
