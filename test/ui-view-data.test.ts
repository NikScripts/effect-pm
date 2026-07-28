/**
 * View.compose data door — same *Bundle builders; reads shared RuntimeProvider.
 */
import * as React from "react";
import { describe, expect, it } from "@effect/vitest";
import { Layer, Schema } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { renderToString } from "react-dom/server";
import * as Group from "../src/Group";
import * as Node from "../src/Node";
import * as WorkPool from "../src/WorkPool";
import * as Daemon from "../src/Daemon";
import * as Navigator from "../src/ui/Navigator";
import * as View from "../src/ui/View";
import { RuntimeProvider, data as runtimeData } from "../src/ui/runtime";

const Item = Schema.Struct({ n: Schema.Number });
class AppNode extends Node.Tag<AppNode>()("app/data/Node", {
  url: "http://127.0.0.1:9/rpc",
  kind: "Http",
}) {}
class Jobs extends WorkPool.Tag<Jobs>()("app/data/Jobs", {
  payload: Item,
  node: AppNode,
}) {}
class Nightly extends Daemon.Tag<Nightly>()("app/data/Nightly", {
  node: AppNode,
}) {}
class Hub extends Group.Tag<Hub>("app/data/Hub")({ Jobs, Nightly }) {}

class PoolCard extends View.Card.Tag<PoolCard>()("hyperlink/view/data-pool-card") {}

const chrome = View.provide(PoolCard, () => null);
const views = View.bind(WorkPool.kind, PoolCard).pipe(
  Layer.provideMerge(chrome),
  Layer.provideMerge(View.base),
);

describe("View.compose data door", () => {
  it("exposes the shared runtime data door", () => {
    const ui = View.compose({
      views,
      navigator: Navigator.memory(Hub),
    });
    expect(ui.data).toBe(runtimeData);
    expect(typeof ui.data.queue).toBe("function");
    expect(typeof ui.data.daemon).toBe("function");
    expect(typeof ui.data.node).toBe("function");
  });

  it("ui.data.queue / ui.data.daemon read RuntimeProvider", () => {
    const ui = View.compose({
      views,
      navigator: Navigator.memory(Hub),
    });
    const runtime = Atom.runtime(Layer.empty);

    const Probe = (): React.ReactElement => {
      const queue = ui.data.queue(Jobs);
      const daemon = ui.data.daemon(Nightly);
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
    const ui = View.compose({
      views,
      navigator: Navigator.memory(Hub),
    });
    const Probe = (): React.ReactElement => {
      ui.data.queue(Jobs);
      return React.createElement("span");
    };
    expect(() => renderToString(React.createElement(Probe))).toThrow(
      /RuntimeProvider/,
    );
  });
});
