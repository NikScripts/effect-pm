/**
 * Navigator.memory — short-name paths, pathToMember, toHref.
 */
import { describe, expect, it } from "@effect/vitest";
import { Context, Effect, Layer } from "effect";
import * as Daemon from "../src/Daemon";
import * as Group from "../src/Group";
import { pathToMember } from "../src/ui/groupRoute";
import * as Navigator from "../src/ui/Navigator";

class HttpApi extends Daemon.Tag<HttpApi>()("test/nav/HttpApi") {}
class Nwsl extends Group.Tag<Nwsl>("test/nav/Nwsl")({ HttpApi }) {}
class Hub extends Group.Tag<Hub>("test/nav/Hub")({ Nwsl }) {}

const runNavigator = <A>(layer: Layer.Layer<Navigator.Navigator>, f: (nav: Navigator.Service) => A): A =>
  Effect.runSync(
    Effect.scoped(
      Effect.gen(function* () {
        const ctx = yield* Layer.build(layer);
        return f(Context.get(ctx, Navigator.Navigator));
      }),
    ),
  );

describe("Navigator.memory", () => {
  it("open by member yields short-name path", () => {
    runNavigator(Navigator.memory(Hub), (nav) => {
      nav.open(HttpApi);
      expect(nav.path).toEqual(["Nwsl", "HttpApi"]);
      expect(nav.selected).toBe(HttpApi);
      expect(nav.group).toBe(Nwsl);
    });
  });

  it("pathToMember + toHref match short names", () => {
    expect(pathToMember(Hub, HttpApi)).toEqual(["Nwsl", "HttpApi"]);
    expect(pathToMember(Hub, Nwsl)).toEqual(["Nwsl"]);
    expect(Navigator.toHref(["Nwsl", "HttpApi"])).toBe("/Nwsl/HttpApi");
    expect(Navigator.toHref([])).toBe("/");
  });

  it("openKey / back walk the tree", () => {
    runNavigator(Navigator.memory(Hub), (nav) => {
      nav.openKey("Nwsl");
      expect(nav.path).toEqual(["Nwsl"]);
      expect(nav.selected).toBeNull();
      expect(nav.group).toBe(Nwsl);
      nav.openKey("HttpApi");
      expect(nav.path).toEqual(["Nwsl", "HttpApi"]);
      nav.back();
      expect(nav.path).toEqual(["Nwsl"]);
      nav.back();
      expect(nav.path).toEqual([]);
      expect(nav.group).toBe(Hub);
    });
  });
});
