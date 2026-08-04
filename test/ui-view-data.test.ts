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
import * as GroupNav from "../src/ui/GroupNav";
import * as Route from "../src/ui/Route";
import * as Router from "../src/ui/Router";
import * as View from "../src/ui/View";
import * as WorkPoolView from "../src/ui/WorkPoolView";
import * as DaemonView from "../src/ui/DaemonView";
import { RuntimeProvider, useRuntime } from "../src/ui/runtime";

import * as Views from "../src/ui/Views";
const Item = Schema.Struct({ n: Schema.Number });
class AppNode extends Node.Service<AppNode>()("app/runtime/Node", {
  url: "http://127.0.0.1:9/rpc",
  kind: "Http",
}) {}
class Jobs extends WorkPool.Service<Jobs>()("app/runtime/Jobs", {
  payload: Item,
  node: AppNode,
}) {}
class Nightly extends Daemon.Service<Nightly>()("app/runtime/Nightly", {
  node: AppNode,
}) {}
class Hub extends Group.Service<Hub>("app/runtime/Hub")({ Jobs, Nightly }) {}

const hubSite = Route.make("hub").add(
  Route.group("tree", { topLevel: true }).fromEffect(Group.asRoutes(Hub)),
);

class PoolCard extends Views.Card.Service<PoolCard>()("hyperlink/view/runtime-pool-card") {}

const chrome = View.succeed(PoolCard, () => null);
const views = Views.bind(WorkPool.kind, PoolCard).pipe(
  Layer.provideMerge(chrome),
  Layer.provideMerge(Views.base),
);

describe("RuntimeProvider + Observe.use", () => {
  it("compose has no data door", () => {
    const ui = Views.compose({
      views,
      router: Router.memory(hubSite),
    });
    expect("data" in ui).toBe(false);
  });

  it("compose accepts a live Router.Service", () => {
    const router = Router.make(hubSite, "Memory");
    GroupNav.open(Hub, router, Jobs);
    const ui = Views.compose({ views, router, group: Hub });
    expect(ui.router).toBe(router);
    expect(ui.router.pathname).toBe("/Jobs");
    expect(GroupNav.state(Hub, ui.router).selected).toBe(Jobs);
  });

  it("compose without a Group leaves Grid empty and Outlet route-only", () => {
    const site = Route.make("plain").add(
      Route.get("handled", "/handled").pipe(
        Route.handle(() => React.createElement("span", null, "handled")),
      ),
    );
    const ui = Views.compose({
      views,
      router: Router.memory(site),
    });
    ui.router.go("/handled");
    const html = renderToString(
      React.createElement(
        ui.Provider,
        null,
        React.createElement(ui.Grid),
        React.createElement(ui.Outlet),
      ),
    );
    expect(html).toBe("<span>handled</span>");
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
