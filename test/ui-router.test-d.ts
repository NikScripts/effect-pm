/**
 * Router Service discriminants + Waku surface (type locks).
 */
import { expectTypeOf } from "vitest";
import * as Route from "../src/ui/Route";
import * as Memory from "last-ts/Memory";
import * as Router from "../src/ui/Router";
import * as RouterWaku from "../src/ui/RouterWaku";

const site = Route.make("site").add(Route.get("home", "/"));

const memory = Memory.service(site);
expectTypeOf(memory._tag).toEqualTypeOf<"Memory" | "History" | "Waku">();
expectTypeOf(memory._tag).toEqualTypeOf<Router.Service["_tag"]>();

// Retired field — must not exist on Service
// @ts-expect-error Service uses `_tag`, not `mode`
memory.mode;

const binding = RouterWaku.waku(site);
expectTypeOf(binding._tag).toEqualTypeOf<"WakuBinding">();
expectTypeOf(binding.api).toEqualTypeOf(site);

// @ts-expect-error WakuBinding has no redundant mode field
binding.mode;

// Waku module is not a Router namespace mirror
// @ts-expect-error no make
RouterWaku.make;
// @ts-expect-error Memory layer stays on ui/Router
RouterWaku.memory;
// @ts-expect-error History layer stays on ui/Router
RouterWaku.history;
// @ts-expect-error Outlet stays on ui/Router
RouterWaku.Outlet;
// @ts-expect-error Context tag stays on ui/Router
RouterWaku.Router;
// @ts-expect-error nested Provider / setDefault removed — use Last.provider
RouterWaku.Provider;
// @ts-expect-error setDefault removed — use Last.provider
RouterWaku.setDefault;
// `layer` is the Waku location Layer re-exported from last-ts/Waku (Last.provider(Waku.layer)).
RouterWaku.layer;

type Target = Route.TargetValue;
expectTypeOf<Target["_tag"]>().toEqualTypeOf<
  "Group" | "Leaf" | "LeafView" | "Health"
>();

declare const leafView: Extract<Target, { _tag: "LeafView" }>;
expectTypeOf(Route.viewOf(leafView)).toEqualTypeOf<string | undefined>();
expectTypeOf(Route.memberOf(leafView)).toEqualTypeOf<unknown | null>();

declare const group: Extract<Target, { _tag: "Group" }>;
expectTypeOf(Route.viewOf(group)).toEqualTypeOf<string | undefined>();
expectTypeOf(Route.memberOf(group)).toEqualTypeOf<unknown | null>();
