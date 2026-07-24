/**
 * @module tui/useGroupRoute
 *
 * In-memory Group routing for the Ink dashboard — same resolve math as the web
 * {@link ../web/useGroupRoute}, without the History API. `initialPath` is the CLI bare-path
 * focus (`hyperlink Mail` → `["Mail"]`).
 *
 */
import * as React from "react";
import {
  pathToLeafKey,
  resolveGroupRoute,
  type GroupRoute,
  type RouteGroup,
} from "../ui/groupRoute";

export type { GroupRoute };

/**
 * Bind React state to a position in a `Group` tree. Returns the resolved nav state plus
 * `open` / `back` / `toRoot` / `goTo` actions.
 *
 * @public
 */
export const useGroupRoute = (
  root: RouteGroup,
  initialPath: ReadonlyArray<string> = [],
): GroupRoute & {
  /** Jump to an absolute key path (e.g. command-palette pick). */
  readonly goTo: (next: ReadonlyArray<string>) => void;
  /** Jump to the member-key path of a leaf by its tag `key`. */
  readonly goToLeaf: (tagKey: string) => void;
} => {
  const [keys, setKeys] = React.useState<ReadonlyArray<string>>(
    () => resolveGroupRoute(root, initialPath).keys,
  );

  const navigate = React.useCallback((next: ReadonlyArray<string>): void => {
    setKeys(next);
  }, []);

  const { trail, selected, view, keys: resolvedKeys } = React.useMemo(
    () => resolveGroupRoute(root, keys),
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
    goTo: navigate,
    goToLeaf: React.useCallback(
      (tagKey: string) => {
        const path = pathToLeafKey(root, tagKey);
        if (path !== undefined) navigate(path);
      },
      [navigate, root],
    ),
  };
};
