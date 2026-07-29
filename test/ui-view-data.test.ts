/**
 * RuntimeProvider — Observe.use / useRuntime require the shared runtime context.
 */
import * as React from "react";
import { describe, expect, it } from "@effect/vitest";
import { Layer, Schema } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { renderToString } from "react-dom/server";
import * as Group from "../src/Group";
import * as Node from "../src/Node";
import * as Observe from "../src/Observe";
import * as WorkPool from "../src/WorkPool";
import * as Daemon from "../src/Daemon";
import * as Router from "../src/ui/Router";
import * as View from "../src/ui/View";
import * as WorkPoolView from "../src/ui/WorkPoolView";
import * as DaemonView from "../src/ui/DaemonView";
import { RuntimeProvider, useRuntime } from "../src/ui/runtime";

const Item = Schema.Struct({ n: Schema.Number });
class AppNode extends Node.Tag<AppNode>()("app/runtime/Node", {
  url: "http://127.0.0.1:9/rpc",
  kind: "Http",
}) {}
class Jobs extends WorkPool.Tag<Jobs>()("app/runtime/Jobs", {
  payload: Item,
  node: AppNode,
}) {}
class Nightly extends Daemon.Tag<Nightly>()("app/runtime/Nightly", {
  node: AppNode,
}) {}
class Hub extends Group.Tag<Hub>("app/runtime/Hub")({ Jobs, Nightly }) {}

class PoolCard extends View.Card.Tag<PoolCard>()("hyperlink/view/runtime-pool-card") {}

const chrome = View.provide(PoolCard, () => null);
const views = View.bind(WorkPool.kind, PoolCard).pipe(
  Layer.provideMerge(chrome),
  Layer.provideMerge(View.base),
);

describe("RuntimeProvider + Observe.use", () => {
  it("compose has no data door", () => {
    const ui = View.compose({
      views,
      router: Router.memory(Hub),
    });
    expect("data" in ui).toBe(false);
  });

  it("compose accepts a live Router.Service", () => {
    const router = Router.makeGroup(Hub, "memory");
    router.open(Jobs);
    const ui = View.compose({ views, router });
    expect(ui.router).toBe(router);
    expect(ui.router.pathname).toBe("/Jobs");
    expect(ui.router.selected).toBe(Jobs);
  });

  it("Observe.use reads RuntimeProvider", () => {
    const runtime = Atom.runtime(Layer.empty);

    const Probe = (): React.ReactElement => {
      const queue = Observe.use(Jobs, WorkPoolView.pack);
      const daemon = Observe.use(Nightly, DaemonView.pack);
      expect(queue.status).toBeDefined();
      expect(queue.metrics).toBeDefined();
      expect(queue.logs).toBeDefined();
      expect(daemon.status).toBeDefined();
      expect(daemon.logs).toBeDefined();
      return React.createElement("span", {
        "data-ok": "1",
        "data-keys": Object.keys(queue).sort().join(","),
      });
    };

    const html = renderToString(
      RuntimeProvider({
        runtime,
        children: React.createElement(Probe),
      }),
    );
    expect(html).toContain('data-ok="1"');
    expect(html).toContain("status");
  });

  it("throws without RuntimeProvider", () => {
    const Probe = (): React.ReactElement => {
      useRuntime();
      return React.createElement("span");
    };
    expect(() => renderToString(React.createElement(Probe))).toThrow(
      /RuntimeProvider/,
    );
  });
});
