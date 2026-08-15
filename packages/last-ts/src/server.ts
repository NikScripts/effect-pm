/**
 * @module server
 *
 * **Not a package export.** Host-only bridge (`fromPage`) for monorepo Waku
 * entries that still need Page → createPage adapt. Apps do not import this.
 *
 * @internal
 */
export { fromPage, type HostPage } from "./internal/hostPage";
