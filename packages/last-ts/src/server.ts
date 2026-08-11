/**
 * @module server
 *
 * **Not the product host API.** Thin re-exports of Waku’s RSC entry helpers for
 * legacy/internal host wiring. Apps compose {@link ./Page}, {@link ./RootLayout},
 * {@link ./Last.provider}, and the Router catalog — they do **not** author
 * `createPages` / `createRoot` / `createLayout` lists.
 *
 * {@link fromPage} adapts a Page mint to Waku flat props when an internal host
 * bridge needs it. Do not teach `createPages` in examples or guides.
 *
 * @internal
 */

export { createPages } from "waku/router/server";
export { default as adapter } from "waku/adapters/default";
export { fromPage, type HostPage } from "./internal/hostPage";
