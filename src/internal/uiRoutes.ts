/**
 * Internal impl for {@link ../ui/Route} catalog/nest helpers (HttpApi-shaped).
 * Group → route reflection lives in {@link ../ui/GroupRoute}.
 */
import * as Context from "effect/Context";
import * as Option from "effect/Option";
import { type Pipeable, pipeArguments } from "effect/Pipeable";
import * as Predicate from "effect/Predicate";
import * as uiRoute from "./uiRoute";
import type { Path } from "./uiRoute";

export const TypeId = "~hyperlink-ts/ui/Route/App" as const;
export const GroupTypeId = "~hyperlink-ts/ui/Route/Group" as const;

/** Annotation: Hyperlink Group/leaf member (stamped by {@link ../ui/GroupRoute}). */
export class Member extends Context.Service<Member, unknown>()(
  "hyperlink-ts/internal/uiRoutes/Member",
) {}

/** Annotation: leaf sub-view id on a `Route.get` under a leaf. */
export class LeafView extends Context.Service<LeafView, string>()(
  "hyperlink-ts/internal/uiRoutes/LeafView",
) {}

export type RouteLike = uiRoute.Constraint | GroupConstraint;

export interface GroupConstraint extends Pipeable {
  readonly [GroupTypeId]: typeof GroupTypeId;
  readonly identifier: string;
  readonly path: Path | undefined;
  readonly topLevel: boolean;
  readonly routes: Readonly<Record<string, uiRoute.Constraint>>;
  readonly groups: Readonly<Record<string, GroupConstraint>>;
  readonly annotations: Context.Context<never>;
  add(...items: ReadonlyArray<RouteLike>): GroupConstraint;
  prefix(prefix: Path): GroupConstraint;
  annotate<I, S>(tag: Context.Key<I, S>, value: S): GroupConstraint;
}

export interface AppConstraint extends Pipeable {
  readonly [TypeId]: typeof TypeId;
  readonly identifier: string;
  readonly groups: Readonly<Record<string, GroupConstraint>>;
  readonly annotations: Context.Context<never>;
  add(...items: ReadonlyArray<RouteLike>): AppConstraint;
  prefix(prefix: Path): AppConstraint;
  annotate<I, S>(tag: Context.Key<I, S>, value: S): AppConstraint;
}

export const isGroup = (u: unknown): u is GroupConstraint =>
  Predicate.hasProperty(u, GroupTypeId);

export const isApp = (u: unknown): u is AppConstraint =>
  Predicate.hasProperty(u, TypeId);

const groupProto = {
  pipe() {
    return pipeArguments(this, arguments);
  },
  add(this: GroupConstraint, ...items: ReadonlyArray<RouteLike>): GroupConstraint {
    let routes = { ...this.routes };
    let groups = { ...this.groups };
    for (const item of items) {
      if (uiRoute.isRoute(item)) {
        routes = { ...routes, [item.identifier]: item };
      } else {
        groups = { ...groups, [item.identifier]: item };
      }
    }
    return makeGroupProto({
      identifier: this.identifier,
      path: this.path,
      topLevel: this.topLevel,
      routes,
      groups,
      annotations: this.annotations,
    });
  },
  prefix(this: GroupConstraint, prefix: Path): GroupConstraint {
    const routes: Record<string, uiRoute.Constraint> = {};
    for (const [id, route] of Object.entries(this.routes)) {
      routes[id] = route.prefix(prefix);
    }
    const groups: Record<string, GroupConstraint> = {};
    for (const [id, child] of Object.entries(this.groups)) {
      groups[id] = child.prefix(prefix);
    }
    return makeGroupProto({
      identifier: this.identifier,
      path:
        this.path === undefined
          ? undefined
          : uiRoute.joinPath(prefix, this.path),
      topLevel: this.topLevel,
      routes,
      groups,
      annotations: this.annotations,
    });
  },
  annotate<I, S>(
    this: GroupConstraint,
    tag: Context.Key<I, S>,
    value: S,
  ): GroupConstraint {
    return makeGroupProto({
      identifier: this.identifier,
      path: this.path,
      topLevel: this.topLevel,
      routes: this.routes,
      groups: this.groups,
      annotations: Context.add(this.annotations, tag, value),
    });
  },
};

const makeGroupProto = (options: {
  readonly identifier: string;
  readonly path: Path | undefined;
  readonly topLevel: boolean;
  readonly routes: Readonly<Record<string, uiRoute.Constraint>>;
  readonly groups: Readonly<Record<string, GroupConstraint>>;
  readonly annotations: Context.Context<never>;
}): GroupConstraint =>
  Object.assign(Object.create(groupProto), {
    [GroupTypeId]: GroupTypeId,
    identifier: options.identifier,
    path: options.path,
    topLevel: options.topLevel,
    routes: options.routes,
    groups: options.groups,
    annotations: options.annotations,
  }) as GroupConstraint;

export const group = <const Id extends string>(
  identifier: Id,
  options?: {
    readonly path?: Path | undefined;
    readonly topLevel?: boolean | undefined;
  },
): GroupConstraint =>
  makeGroupProto({
    identifier,
    path: options?.path,
    topLevel: options?.topLevel ?? false,
    routes: {},
    groups: {},
    annotations: Context.empty(),
  });

const appProto = {
  pipe() {
    return pipeArguments(this, arguments);
  },
  add(this: AppConstraint, ...items: ReadonlyArray<RouteLike>): AppConstraint {
    let groups = { ...this.groups };
    for (const item of items) {
      if (uiRoute.isRoute(item)) {
        const id = "__top";
        const existing = groups[id] ?? group(id, { topLevel: true });
        groups = { ...groups, [id]: existing.add(item) };
      } else if (item.topLevel) {
        // Merge top-level groups into a shared bucket so urlBuilder flattens methods.
        const id = "__top";
        const existing = groups[id] ?? group(id, { topLevel: true });
        groups = {
          ...groups,
          [id]: existing.add(
            ...Object.values(item.routes),
            ...Object.values(item.groups),
          ),
        };
      } else {
        groups = { ...groups, [item.identifier]: item };
      }
    }
    return makeAppProto({
      identifier: this.identifier,
      groups,
      annotations: this.annotations,
    });
  },
  prefix(this: AppConstraint, prefix: Path): AppConstraint {
    const groups: Record<string, GroupConstraint> = {};
    for (const [id, g] of Object.entries(this.groups)) {
      groups[id] = g.prefix(prefix);
    }
    return makeAppProto({
      identifier: this.identifier,
      groups,
      annotations: this.annotations,
    });
  },
  annotate<I, S>(
    this: AppConstraint,
    tag: Context.Key<I, S>,
    value: S,
  ): AppConstraint {
    return makeAppProto({
      identifier: this.identifier,
      groups: this.groups,
      annotations: Context.add(this.annotations, tag, value),
    });
  },
};

const makeAppProto = (options: {
  readonly identifier: string;
  readonly groups: Readonly<Record<string, GroupConstraint>>;
  readonly annotations: Context.Context<never>;
}): AppConstraint =>
  Object.assign(Object.create(appProto), {
    [TypeId]: TypeId,
    identifier: options.identifier,
    groups: options.groups,
    annotations: options.annotations,
  }) as AppConstraint;

/** Empty catalog — `HttpApi.make` analogue. */
export const make = <const Id extends string>(identifier: Id): AppConstraint =>
  makeAppProto({
    identifier,
    groups: {},
    annotations: Context.empty(),
  });

// =============================================================================
// Reflect / match / urlBuilder
// =============================================================================

export type FlatEntry = {
  readonly kind: "route" | "group";
  readonly identifiers: ReadonlyArray<string>;
  readonly path: Path;
  readonly route: uiRoute.Constraint | undefined;
  readonly group: GroupConstraint;
  readonly annotations: Context.Context<never>;
};

export const flatten = (self: AppConstraint): ReadonlyArray<FlatEntry> => {
  const out: Array<FlatEntry> = [];
  const walkGroup = (
    g: GroupConstraint,
    parentAnnotations: Context.Context<never>,
    identifiers: ReadonlyArray<string>,
  ): void => {
    const merged = Context.merge(parentAnnotations, g.annotations);
    const ids =
      g.topLevel || g.identifier === "__top"
        ? identifiers
        : [...identifiers, g.identifier];
    if (g.path !== undefined) {
      out.push({
        kind: "group",
        identifiers: ids,
        path: g.path,
        route: undefined,
        group: g,
        annotations: merged,
      });
    }
    for (const route of Object.values(g.routes)) {
      out.push({
        kind: "route",
        identifiers: [...ids, route.identifier],
        path: route.path,
        route,
        group: g,
        annotations: Context.merge(merged, route.annotations),
      });
    }
    for (const child of Object.values(g.groups)) {
      walkGroup(child, merged, ids);
    }
  };
  for (const g of Object.values(self.groups)) {
    walkGroup(g, self.annotations, []);
  }
  return out;
};

export type Match = {
  readonly pathname: string;
  readonly kind: "route" | "group";
  readonly identifiers: ReadonlyArray<string>;
  readonly path: Path;
  readonly params: Record<string, string>;
  readonly route: uiRoute.Constraint | undefined;
  readonly group: GroupConstraint;
  readonly annotations: Context.Context<never>;
  readonly member: unknown | undefined;
  readonly leafView: string | undefined;
};

export const match = (
  self: AppConstraint,
  pathname: string,
): Option.Option<Match> => {
  const normalized =
    pathname === "" || pathname === "/"
      ? "/"
      : pathname.endsWith("/") && pathname.length > 1
        ? pathname.slice(0, -1)
        : pathname;

  if (normalized === "/") return Option.none();

  let best: Match | undefined;
  let bestScore = -1;

  for (const entry of flatten(self)) {
    const compiled = uiRoute.compilePath(entry.path);
    const paramsOpt = compiled.match(normalized);
    if (Option.isNone(paramsOpt)) continue;
    const score = entry.path.length;
    if (score < bestScore) continue;
    const params = paramsOpt.value;
    const annotations = entry.annotations;
    bestScore = score;
    best = {
      pathname: normalized,
      kind: entry.kind,
      identifiers: entry.identifiers,
      path: entry.path,
      params,
      route: entry.route,
      group: entry.group,
      annotations,
      member: Context.getOption(annotations, Member).pipe(
        Option.getOrUndefined,
      ),
      leafView: Context.getOption(annotations, LeafView).pipe(
        Option.getOrUndefined,
      ),
    };
  }
  return Option.fromUndefinedOr(best);
};

export type UrlBuilder = {
  [key: string]: UrlBuilder | UrlMethod;
};

export type UrlMethod = (request?: {
  readonly params?: Record<string, string> | undefined;
}) => string;

/**
 * Nested URL builder — same nesting idea as `HttpApiClient.urlBuilder`.
 * Path-bearing groups are callable (`urls.Nwsl()`); child routes/groups nest.
 */
export const urlBuilder = (self: AppConstraint): UrlBuilder => {
  const root: UrlBuilder = {};

  /** Nest node that may also be callable (`urls.Nwsl()` + `urls.Nwsl.HttpApi`). */
  const ensure = (target: UrlBuilder, id: string): UrlBuilder => {
    const existing = target[id];
    if (existing === undefined) {
      const nest: UrlBuilder = {};
      target[id] = nest;
      return nest;
    }
    if (typeof existing === "function") {
      return existing as unknown as UrlBuilder;
    }
    return existing;
  };

  const setCallable = (
    target: UrlBuilder,
    id: string,
    method: UrlMethod,
  ): void => {
    const existing = target[id];
    if (existing === undefined) {
      target[id] = method as unknown as UrlBuilder;
      return;
    }
    if (typeof existing === "function") {
      // Already callable — keep nested props; prefer first method (stable).
      return;
    }
    // Promote plain nest to callable while keeping children.
    const fn = Object.assign(
      ((request?: { readonly params?: Record<string, string> }) =>
        method(request)) as UrlMethod,
      existing,
    );
    target[id] = fn as unknown as UrlBuilder;
  };

  const place = (identifiers: ReadonlyArray<string>, path: Path): void => {
    if (identifiers.length === 0) return;
    let cursor = root;
    for (let i = 0; i < identifiers.length - 1; i++) {
      cursor = ensure(cursor, identifiers[i]!);
    }
    const leafId = identifiers[identifiers.length - 1]!;
    const compiled = uiRoute.compilePath(path);
    const method: UrlMethod = (request) =>
      compiled.build(request?.params ?? {});
    setCallable(cursor, leafId, method);
  };

  for (const entry of flatten(self)) {
    place(entry.identifiers, entry.path);
  }

  return root;
};

export const reflect = (
  self: AppConstraint,
  options: {
    readonly onGroup?: (entry: {
      readonly group: GroupConstraint;
      readonly identifiers: ReadonlyArray<string>;
      readonly path: Path | undefined;
      readonly annotations: Context.Context<never>;
    }) => void;
    readonly onRoute?: (entry: {
      readonly route: uiRoute.Constraint;
      readonly group: GroupConstraint;
      readonly identifiers: ReadonlyArray<string>;
      readonly annotations: Context.Context<never>;
    }) => void;
  },
): void => {
  const walk = (
    g: GroupConstraint,
    parent: Context.Context<never>,
    identifiers: ReadonlyArray<string>,
  ): void => {
    const merged = Context.merge(parent, g.annotations);
    const ids =
      g.topLevel || g.identifier === "__top"
        ? identifiers
        : [...identifiers, g.identifier];
    options.onGroup?.({
      group: g,
      identifiers: ids,
      path: g.path,
      annotations: merged,
    });
    for (const route of Object.values(g.routes)) {
      options.onRoute?.({
        route,
        group: g,
        identifiers: [...ids, route.identifier],
        annotations: Context.merge(merged, route.annotations),
      });
    }
    for (const child of Object.values(g.groups)) {
      walk(child, merged, ids);
    }
  };
  for (const g of Object.values(self.groups)) {
    walk(g, self.annotations, []);
  }
};
