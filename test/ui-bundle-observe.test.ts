/**
 * Bundle.observe — namespaced door over use*Bundle.
 */
import * as React from "react";
import { describe, expect, it } from "@effect/vitest";
import { Layer, Schema } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { renderToString } from "react-dom/server";
import * as Daemon from "../src/Daemon";
import * as Group from "../src/Group";
import * as Node from "../src/Node";
import * as WorkPool from "../src/WorkPool";
import * as Bundle from "../src/ui/Bundle";
import * as Navigator from "../src/ui/Navigator";
import { RuntimeProvider } from "../src/ui/runtime";
import * as View from "../src/ui/View";

const Item = Schema.Struct({ n: Schema.Number });
class AppNode extends Node.Tag<AppNode>()("app/bundle/Node", {
  url: "http://127.0.0.1:9/rpc",
  kind: "Http",
}) {}
class Jobs extends WorkPool.Tag<Jobs>()("app/bundle/Jobs", {
  payload: Item,
  node: AppNode,
}) {}
class Nightly extends Daemon.Tag<Nightly>()("app/bundle/Nightly", {
  node: AppNode,
}) {}
class Hub extends Group.Tag<Hub>("app/bundle/Hub")({ Jobs, Nightly }) {}

class PoolCard extends View.Card.Tag<PoolCard>()("hyperlink/view/bundle-pool-card") {}

const views = View.bind(WorkPool.kind, PoolCard).pipe(
  Layer.provideMerge(View.provide(PoolCard, () => null)),
  Layer.provideMerge(View.base),
);

describe("Bundle.observe", () => {
  it("returns queue / daemon bundles under RuntimeProvider", () => {
    const ui = View.compose({
      views,
      navigator: Navigator.memory(Hub),
    });
    const runtime = Atom.runtime(Layer.empty);
    let queueKeys: ReadonlyArray<string> | undefined;
    let daemonKeys: ReadonlyArray<string> | undefined;

    function Probe() {
      const q = Bundle.observe(Jobs);
      const d = Bundle.observe(Nightly);
      queueKeys = Object.keys(q).sort();
      daemonKeys = Object.keys(d).sort();
      return null;
    }

    renderToString(
      RuntimeProvider({
        runtime,
        children: React.createElement(ui.Provider, null, React.createElement(Probe)),
      }),
    );

    expect(queueKeys).toContain("status");
    expect(queueKeys).toContain("pause");
    expect(daemonKeys).toContain("status");
    expect(daemonKeys).toContain("start");
  });
});
