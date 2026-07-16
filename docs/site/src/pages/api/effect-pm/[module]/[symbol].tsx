import { ApiSymbolPage } from "../../../../components/ApiSymbolPage.js";
import { symbolPaths } from "../../../../lib/api-data.js";
import { runServer } from "../../../../lib/runtime.js";

// effect-pm's OWN symbols, pre-rendered at build (a literal `effect-pm` segment, so Waku routes these
// here instead of the dynamic /api/[pkg]/… route). Only ~567 pages — well within the static build's
// limits — so our package's docs are fully static: fast, CDN-cacheable, and served even with no server.
export default function EffectPmSymbolPage({
  module,
  symbol,
}: {
  module: string;
  symbol: string;
}) {
  return ApiSymbolPage({ pkg: "effect-pm", module, symbol });
}

export const getConfig = async () =>
  ({
    render: "static",
    staticPaths: (await runServer(symbolPaths()))
      .filter(([p]) => p === "effect-pm")
      .map(([, m, sym]) => [m, sym] as const),
  }) as const;
