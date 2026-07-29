/**
 * @module ui/Routes
 *
 * UI route catalog — HttpApi-shaped (`make` / `group` / `add` / `prefix` / `reflect`)
 * with **path-bearing groups** so nested URLs stay typed. Dynamic generation from a
 * Hyperlink Group uses the **same builders** as hand-written routes:
 *
 * ```ts
 * import * as Route from "hyperlink-ts/ui/Route"
 * import * as Routes from "hyperlink-ts/ui/Routes"
 * import { Schema } from "effect"
 *
 * const Dashboard = Routes.make("dashboard").add(
 *   Routes.group("shell", { topLevel: true }).add(
 *     Route.make("health", "/health"),
 *     Route.make("node", "/health/:nodeId").pipe(
 *       Route.params(Schema.Struct({ nodeId: Schema.String })),
 *     ),
 *   ),
 *   Routes.fromGroup(ServicesHub, { leafViews: ["logs", "schedule"] }),
 * )
 *
 * const urls = Routes.urlBuilder(Dashboard)
 * urls.health()                 // "/health"
 * urls.node({ params: { nodeId: "n1" } })
 * urls.Nwsl()                   // "/Nwsl"
 * urls.Nwsl.HttpApi()           // "/Nwsl/HttpApi"
 * urls.Nwsl.HttpApi.logs()      // "/Nwsl/HttpApi/logs"
 *
 * Routes.match(Dashboard, "/Nwsl/HttpApi")
 * ```
 *
 * Navigator / location binding is separate — this module is the declaration +
 * match + URL surface everyone shares.
 *
 * @see docs/handoffs/ui-routes-dream.md
 */
import type * as Context from "effect/Context";
import type * as Option from "effect/Option";
import type * as Route from "./Route";
import * as internal from "../internal/uiRoutes";

/** Absolute path template. @public */
export type Path = Route.Path;

/**
 * Nested group of routes — may itself be navigable via {@link group}'s `path`
 * (layout route; HttpApi groups are not path-bearing — that is the deliberate
 * UI extension so `fromGroup` and hand-written trees share one tool).
 *
 * @public
 */
export interface Group extends internal.GroupConstraint {}

/**
 * Route catalog (`HttpApi` analogue).
 *
 * @public
 */
export interface Routes extends internal.RoutesConstraint {}

/** Route or group — what {@link Routes.add} / {@link Group.add} accept. @public */
export type RouteLike = internal.RouteLike;

/** @public */
export const isGroup: (u: unknown) => u is Group = internal.isGroup;

/** @public */
export const isRoutes: (u: unknown) => u is Routes = internal.isRoutes;

/**
 * Annotation stamped by {@link fromGroup} — the Group or leaf member.
 *
 * @public
 */
export const Member: typeof internal.Member = internal.Member;

/**
 * Annotation for a leaf sub-view name (`logs` / `schedule`).
 *
 * @public
 */
export const LeafView: typeof internal.LeafView = internal.LeafView;

/**
 * Empty catalog.
 *
 * @public
 */
export const make: <const Id extends string>(identifier: Id) => Routes =
  internal.make;

/**
 * Named group. Pass `path` to make the group itself navigable (`urls.Nwsl()`).
 * Pass `topLevel: true` so child route methods flatten onto the parent builder
 * (HttpApi `topLevel` groups).
 *
 * @public
 */
export const group: <const Id extends string>(
  identifier: Id,
  options?: {
    readonly path?: Path | undefined;
    readonly topLevel?: boolean | undefined;
  },
) => Group = internal.group;

/**
 * Reflect a Hyperlink `Group.Tag` tree into nested {@link group}s — **same**
 * `Route.make` / {@link group} / `.add` tools apps use by hand.
 *
 * @public
 */
export const fromGroup: (
  root: internal.SourceGroup,
  options?: internal.FromGroupOptions,
) => Group = internal.fromGroup;

/** Flattened match hit. @public */
export type Match = internal.Match;

/**
 * Match a pathname against the catalog (longest template wins).
 *
 * @public
 */
export const match: (
  self: Routes,
  pathname: string,
) => Option.Option<Match> = internal.match;

/** Nested URL builder (HttpApiClient.urlBuilder shape). @public */
export type UrlBuilder = internal.UrlBuilder;

/**
 * Build typed nested URL helpers from a catalog.
 *
 * @public
 */
export const urlBuilder: (self: Routes) => UrlBuilder = internal.urlBuilder;

/**
 * Walk groups/routes (tooling / codegen).
 *
 * @public
 */
export const reflect: typeof internal.reflect = internal.reflect;

/** Flat list of navigable paths (tests / debugging). @public */
export const flatten: typeof internal.flatten = internal.flatten;

/** Annotate a catalog. @public */
export const annotate = <I, S>(
  self: Routes,
  tag: Context.Key<I, S>,
  value: S,
): Routes => self.annotate(tag, value);
