/**
 * @module examples/apps/view-compose/api
 *
 * **API sketch** — steal shipped `View` / `Route` / `Router` / `Group.asRoutes`.
 */

import type { Layer } from "effect";

/**
 * STEAL — Route catalog is data; Group trees enter via Effect:
 *
 * ```ts
 * const site = Route.make("site").add(
 *   Route.group("hub", { topLevel: true }).effect(Group.asRoutes(ServicesHub)),
 * )
 * History.fromApi(site) // never History.fromApi(ServicesHub)
 * ```
 */
export type StolenRouteCatalog =
  "Route.make | group | get | group.effect | Group.asRoutes";

export interface StolenRouter {
  readonly pathname: string;
  readonly path: ReadonlyArray<string>;
  readonly open: (member: MemberTag) => void;
  readonly up: () => void;
  readonly back: () => void;
  readonly to: (build: (urls: unknown) => string) => void;
}

export declare const ViewCompose: {
  readonly compose: <E>(options: {
    readonly views: Layer.Layer<unknown, E, never>;
    readonly router: Layer.Layer<unknown> | StolenRouter;
  }) => {
    readonly Provider: (props: {
      readonly children: React.ReactNode;
    }) => React.ReactElement;
    readonly Grid: () => React.ReactElement | null;
    readonly Outlet: () => React.ReactElement | null;
    readonly router: StolenRouter;
  };
};

export type MemberTag = unknown;

declare namespace React {
  type ReactNode = unknown;
  type ReactElement = unknown;
}
