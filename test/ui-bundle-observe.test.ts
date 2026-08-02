/**
 * Observe.use — React discharge of *View.pack under RuntimeProvider.
 */
import * as React from "react";
import { describe, expect, it } from "@effect/vitest";
import { Layer, Schema } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { renderToString } from "react-dom/server";
import * as Daemon from "../src/Daemon";
import * as Group from "../src/Group";
import * as Node from "../src/Node";
import * as Observe from "../src/Observe";
import * as WorkPool from "../src/WorkPool";
import * as DaemonView from "../src/ui/DaemonView";
import * as Route from "../src/ui/Route";
import * as Router from "../src/ui/Router";
import { RuntimeProvider } from "../src/ui/runtime";
import * as View from "../src/ui/View";
import * as WorkPoolView from "../src/ui/WorkPoolView";

import * as Views from "../src/ui/Views";
const Item = Schema.Struct({ n: Schema.Number });
class AppNode extends Node.Tag<AppNode>()("app/observe-use/Node", {
  url: "http://127.0.0.1:9/rpc",
  kind: "Http",
}) {}
class Jobs extends WorkPool.Tag<Jobs>()("app/observe-use/Jobs", {
  payload: Item,
  node: AppNode,
}) {}
class Nightly extends Daemon.Tag<Nightly>()("app/observe-use/Nightly", {
  node: AppNode,
}) {}
class Hub extends Group.Tag<Hub>("app/observe-use/Hub")({ Jobs, Nightly }) {}

const hubSite = Route.make("hub").add(
  Route.group("tree", { topLevel: true }).fromEffect(Group.asRoutes(Hub)),
);

class PoolCard extends Views.Card.Tag<PoolCard>()("hyperlink/view/observe-use-pool-card") {}

const views = Views.bind(WorkPool.kind, PoolCard).pipe(
  Layer.provideMerge(View.provide(PoolCard, () => null)),
  Layer.provideMerge(Views.base),
);

describe("Observe.use", () => {
  it("returns queue / daemon packs under RuntimeProvider", () => {
    const ui = Views.compose({
      views,
      router: Router.memory(hubSite),
    });
    const runtime = Atom.runtime(Layer.empty);
    let queueKeys: ReadonlyArray<string> | undefined;
    let daemonKeys: ReadonlyArray<string> | undefined;

    function Probe() {
      const q = Observe.use(Jobs, WorkPoolView.pack);
      const d = Observe.use(Nightly, DaemonView.pack);
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
    expect(queueKeys).toContain("logs");
    expect(daemonKeys).toContain("status");
    expect(daemonKeys).toContain("start");
  });
});
