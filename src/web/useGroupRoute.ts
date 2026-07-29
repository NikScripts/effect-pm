/**
 * @module web/useGroupRoute
 *
 * URL routing that **mirrors the `Group` tree**: the path is the chain of member keys from
 * the root, so `ServicesHub → Wnba → ImportSchedule` is `/Wnba/ImportSchedule`. Matching is
 * **case-insensitive** (`/wnba/importschedule` resolves the same), while the URL keeps the
 * tree's actual key casing. Backed by the History API — deep links and back/forward work.
 *
 * ```tsx
 * const route = useGroupRoute(ServicesHub);
 * route.group;       // the group whose grid to render (deepest in the path)
 * route.selected;    // the open leaf tag, if the path ends on one (else null)
 * route.open("Wnba") // descend into a member by its key
 * route.back();      // up one segment
 * ```
 *
 * Resolve math lives in {@link ../ui/GroupRoute} (shared with the TUI); this hook only
 * binds it to `window.history`.
 *
 */
import * as React from "react";
import {
  formatGroupPath,
  resolveGroupRoute,
  type GroupRoute,
  type RouteGroup,
} from "../ui/GroupRoute";
import type { GroupNode } from "../ui/data";

// GroupRoute type lives on `hyperlink-ts/ui` (and the web barrel via `export * from "../ui"`).
// Do not re-export it here — star-exporting both collides with `export * as GroupRoute`.

const pathSegments = (): ReadonlyArray<string> =>
  (typeof window === "undefined" ? "" : window.location.pathname)
    .split("/")
    .filter((s) => s.length > 0)
    .map(decodeURIComponent);

/**
 * Two-way bind the browser URL to a position in a `Group` tree. Returns the resolved nav
 * state plus `open` / `back` / `toRoot` actions that push history entries.
 *
 */
export const useGroupRoute = (root: GroupNode): GroupRoute => {
  const [keys, setKeys] = React.useState<ReadonlyArray<string>>(
    () => resolveGroupRoute(root as RouteGroup, pathSegments()).keys,
  );

  React.useEffect(() => {
    const onPop = (): void => setKeys(resolveGroupRoute(root as RouteGroup, pathSegments()).keys);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [root]);

  const navigate = React.useCallback((next: ReadonlyArray<string>): void => {
    if (typeof window !== "undefined") window.history.pushState(null, "", formatGroupPath(next));
    setKeys(next);
  }, []);

  const { trail, selected, view, keys: resolvedKeys } = React.useMemo(
    () => resolveGroupRoute(root as RouteGroup, keys),
    [root, keys],
  );

  return {
    trail,
    keys: resolvedKeys,
    group: trail[trail.length - 1] ?? root,
    selected,
    view,
    open: React.useCallback((key: string) => navigate([...keys, key]), [navigate, keys]),
    back: React.useCallback(() => navigate(keys.slice(0, -1)), [navigate, keys]),
    toRoot: React.useCallback(() => navigate([]), [navigate]),
  };
};
