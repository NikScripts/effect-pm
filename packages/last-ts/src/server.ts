/**
 * @module server
 *
 * RSC host server-entry façade. Apps register routes through this module and
 * never import `waku` / `waku/router` / adapters directly. The optional Waku
 * peer stays inside last-ts.
 *
 * Prefer programmatic registration (`createPages`) over Waku’s `fsRouter` —
 * file routing and static/dynamic policy are owned by last-ts (`fileRouter`,
 * Page/Route marks), not Waku’s file-router / `getConfig`.
 *
 * ```ts
 * // src/waku.server.tsx — CLI entry name only
 * import { adapter, createPages } from "last-ts/server"
 * import Home from "./pages/index"
 *
 * export default adapter(
 *   createPages(async ({ createPage, createRoot }) => [
 *     createRoot({ render: "static", component: Root }),
 *     createPage({ render: "static", path: "/", component: Home }),
 *   ]),
 * )
 * ```
 *
 * @public
 */

export { createPages } from "waku/router/server";
export { default as adapter } from "waku/adapters/default";
