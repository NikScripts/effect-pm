import { Schema } from "effect";
import * as Page from "last-ts/Page";
import { ApiSymbolPage } from "../../../../../components/ApiSymbolPage.js";

// The effect DEPENDENCIES (effect, @effect/platform-node, @effect/sql-sqlite-node): rendered on
// demand (SSR), never pre-rendered — effect core alone is ~3900 heavy twoslash pages and statically
// pre-rendering them overflows the build's serializer. Our own package is served statically by the
// sibling /api/hyperlink-ts/[module]/[symbol] route (a literal segment out-matches this dynamic one).
//
// Always dynamic — never mint `Page.static` here (see comment above).
export class ApiSymbolDynamicPage extends Page.make(
  {
    params: {
      pkg: Schema.String,
      module: Schema.String,
      symbol: Schema.String,
    },
  },
  (props: {
    readonly params: {
      readonly pkg: string;
      readonly module: string;
      readonly symbol: string;
    };
  }) => ApiSymbolPage(props.params),
) {}
