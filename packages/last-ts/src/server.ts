/**
 * @module server
 *
 * RSC host server-entry façade. Apps register routes through this module and
 * never import `waku` / `waku/router` / adapters directly.
 *
 * ```ts
 * import * as Server from "last-ts/server"
 * import { Home } from "./pages/index"
 *
 * export default Server.adapter(
 *   Server.createPages(async ({ createPage, createRoot }) => [
 *     createRoot({ render: "static", component: Root }),
 *     createPage({ path: "/", ...Server.fromPage(Home) }),
 *   ]),
 * )
 * ```
 *
 * @public
 */

export { createPages } from "waku/router/server";
export { default as adapter } from "waku/adapters/default";
export { fromPage, type HostPage } from "./internal/hostPage";
