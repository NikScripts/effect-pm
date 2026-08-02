/**
 * @module ui/Ui
 *
 * Hyperlink dashboard chrome — size re-exports from last-ts, Group-aware compose,
 * and Group dash helpers built on `last-ts/View`.
 */
import * as React from "react";
import { Context, Effect, Layer, Option } from "effect";
import * as Group from "../Group";
import * as GroupNav from "./GroupNav";
import * as Router from "./Router";
import * as View from "last-ts/View";

export {
  ViewKind,
  SizeChrome,
  Card,
  Detail,
  Page,
  WithSize,
  bind,
  only,
} from "last-ts/View";

export type ViewTag = View.ViewTag;

/** Group-shaped root for {@link group}. @public */
export type GroupLike = {
  readonly key: string;
  readonly members: Record<string, unknown>;
};

/** Leaf tags collected from a Group tree. @public */
export type GroupLeaf = ViewTag;

const collectLeaves = (node: unknown): ReadonlyArray<GroupLeaf> => {
  if (!Group.isGroup(node)) {
    if (
      (typeof node === "object" || typeof node === "function") &&
      node !== null &&
      "key" in node &&
      typeof (node as { readonly key: unknown }).key === "string"
    ) {
      return [node as GroupLeaf];
    }
    return [];
  }
  return Object.values(Group.members(node)).flatMap(collectLeaves);
};

/**
 * Lightweight Group dash handle — stashed by {@link group} for {@link react}.
 *
 * @public
 */
export class GroupDash extends Context.Service<
  GroupDash,
  {
    readonly group: GroupLike;
    readonly leaves: ReadonlyArray<GroupLeaf>;
  }
>()("hyperlink-ts/ui/Ui/GroupDash") {}

/**
 * BYO-chrome Group kit contribution. Records the Group + leaves for the react kit.
 *
 * @public
 */
export const group = (appGroup: GroupLike): Layer.Layer<GroupDash> =>
  Layer.sync(GroupDash, () => ({
    group: appGroup,
    leaves: collectLeaves(appGroup),
  }));

/**
 * React kit from a fully provided view Layer, with optional {@link groupDash}.
 *
 * @public
 */
export const react = <ROut, E,>(viewLayer: Layer.Layer<ROut, E, never>) => {
  const kit = View.react(viewLayer);
  const groupDash = Effect.runSync(
    Effect.scoped(
      Effect.gen(function* () {
        const ctx = yield* Layer.build(viewLayer);
        return Context.getOption(ctx, GroupDash);
      }),
    ),
  );
  return {
    ...kit,
    groupDash: Option.getOrUndefined(groupDash),
  };
};

const displayNameOf = (tag: ViewTag, fallback: string): string => {
  if (typeof tag === "object" || typeof tag === "function") {
    if (tag !== null && "key" in tag && typeof (tag as { key: unknown }).key === "string") {
      const key = (tag as { key: string }).key;
      const slash = key.lastIndexOf("/");
      return slash >= 0 ? key.slice(slash + 1) : key;
    }
  }
  return fallback;
};

/**
 * Members of the current Group route. Returns an empty list without a Group root.
 *
 * @public
 */
export const useGridMembers = (
  root?: GroupNav.RouteGroup,
): ReadonlyArray<{
  readonly name: string;
  readonly tag: ViewTag;
}> => {
  const router = Router.useRouter();
  if (root === undefined) return [];
  const group = GroupNav.state(root, router).group;
  return Object.entries(Group.members(group)).map(([name, tag]) => ({
    name,
    tag: tag as ViewTag,
  }));
};

/** Live router vs Layer — `Layer.isLayer` predicate is too wide to exclude. @internal */
const isLiveRouter = (
  input: Layer.Layer<Router.Router> | Router.Service,
): input is Router.Service =>
  typeof input === "object" &&
  input !== null &&
  "go" in input &&
  "subscribe" in input &&
  "pathname" in input;

/** Build or accept a live router for {@link compose}. @internal */
const resolveComposeRouter = (
  input: Layer.Layer<Router.Router> | Router.Service,
): Router.Service => {
  if (isLiveRouter(input)) return input;
  return Effect.runSync(
    Effect.scoped(
      Effect.gen(function* () {
        const ctx = yield* Layer.build(input);
        return Context.get(ctx, Router.Router);
      }),
    ),
  );
};

/**
 * Thin Dashboard sugar: {@link react} + {@link Router} Layer **or** live
 * {@link Router.Service}. No second registry; no `Atom.runtime` inside — wrap
 * with {@link ./runtime.RuntimeProvider} outside.
 *
 * @public
 */
export const compose = <VR, VE,>(options: {
  readonly views: Layer.Layer<VR, VE, never>;
  readonly router: Layer.Layer<Router.Router> | Router.Service;
  readonly group?: GroupNav.RouteGroup;
}): ReturnType<typeof react<VR, VE>> & {
  readonly Provider: (props: {
    readonly children: React.ReactNode;
  }) => React.ReactElement;
  readonly Grid: () => React.ReactElement;
  readonly Outlet: () => React.ReactElement | null;
  readonly useGridMembers: typeof useGridMembers;
  readonly router: Router.Service;
} => {
  const viewKit = react(options.views);
  const router = resolveComposeRouter(options.router);
  const group = options.group;

  const Provider = (props: {
    readonly children: React.ReactNode;
  }): React.ReactElement =>
    React.createElement(
      viewKit.Provider,
      null,
      React.createElement(
        Router.Provider,
        { value: router, children: props.children },
      ),
    );

  /** DOM grid — Card per member; click opens via GroupNav. TUI: use {@link useGridMembers}. */
  const Grid = (): React.ReactElement => {
    const members = useGridMembers(group);
    const navigation = Router.useRouter();
    return React.createElement(
      React.Fragment,
      null,
      ...members.map(({ name, tag }) =>
        React.createElement(
          "button",
          {
            key: name,
            type: "button",
            className: "contents",
            onClick: () => {
              if (group !== undefined) GroupNav.open(group, navigation, tag);
            },
          },
          React.createElement(viewKit.Card, { tag, name }),
        ),
      ),
    );
  };

  /**
   * Shell outlet — prefer the matched route's {@link Route.handle}
   * ({@link Router.Outlet}); else Group-dashboard Target → View Detail/Page.
   */
  const Outlet = (): React.ReactElement | null => {
    const navigation = Router.useRouter();
    const handled = Router.Outlet();
    if (handled !== null) return handled;
    if (group === undefined) return null;

    const state = GroupNav.state(group, navigation);
    const selected = state.selected;
    if (selected === null) return null;
    const tag = selected as ViewTag;
    const title = displayNameOf(tag, "detail");

    const back = React.createElement("button", {
      type: "button",
      onClick: () => GroupNav.up(group, navigation),
      disabled: !state.canUp,
    }, "← back");

    if (state.view === "logs" || state.view === "schedule") {
      return React.createElement(
        "div",
        { "data-hyperlink-outlet": state.view },
        React.createElement(
          "div",
          { style: { display: "flex", gap: 8, alignItems: "center", marginBottom: 12 } },
          back,
          React.createElement("strong", null, `${title} · ${state.view}`),
        ),
        React.createElement(viewKit.Page, { tag, name: title }),
      );
    }

    return React.createElement(
      "div",
      { "data-hyperlink-outlet": "detail" },
      React.createElement(
        "div",
        { style: { display: "flex", gap: 8, alignItems: "center", marginBottom: 12 } },
        back,
        React.createElement("strong", null, title),
      ),
      React.createElement(viewKit.Detail, { tag, name: title }),
    );
  };

  return {
    ...viewKit,
    Provider,
    Grid,
    Outlet,
    useGridMembers,
    router,
  };
};
