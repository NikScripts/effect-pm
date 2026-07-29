import { ApiSymbolPage } from "../../../../../components/ApiSymbolPage.js";

// The effect DEPENDENCIES (effect, @effect/platform-node, @effect/sql-sqlite-node): rendered on
// demand (SSR), never pre-rendered — effect core alone is ~3900 heavy twoslash pages and statically
// pre-rendering them overflows the build's serializer. Our own package is served statically by the
// sibling /api/hyperlink-ts/[module]/[symbol] route (a literal segment out-matches this dynamic one).
export default ApiSymbolPage;

export const getConfig = async () => ({ render: "dynamic" }) as const;
