import { Schema } from "effect";
import * as Page from "last-ts/Page";
import { ApiSymbolPage } from "../../../../../components/ApiSymbolPage.js";

// hyperlink-ts's OWN symbols, pre-rendered at build (a literal `hyperlink-ts` segment, so Waku routes these
// here instead of the dynamic /api/[pkg]/… route). Only ~567 pages — well within the static build's
// limits — so our package's docs are fully static: fast, CDN-cacheable, and served even with no server.
// Always static — staticPaths (from `symbolPaths()`) live on `waku.server.tsx`.
export class HyperlinkSymbolPage extends Page.static(
  { params: { module: Schema.String, symbol: Schema.String } },
  (props: { readonly params: { readonly module: string; readonly symbol: string } }) =>
    ApiSymbolPage({ pkg: "hyperlink-ts", ...props.params }),
) {}
