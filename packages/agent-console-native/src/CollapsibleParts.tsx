/**
 * Shared open/closed policy for the transcript's collapsibles — reasoning
 * blocks and tool calls both.
 *
 * The rule: exactly one thing is auto-expanded, the newest collapsible in the
 * transcript. When a newer one appears the previous folds away on its own, so
 * the screen follows what the agent is doing now instead of growing an
 * ever-taller stack of open panels. A manual tap pins that item's state for
 * good and stops it auto-collapsing underneath you.
 *
 * State lives here rather than in the components because `FlatList` unmounts
 * rows that scroll out of view — per-component `useState` would silently
 * forget every manual toggle the moment a message left the viewport.
 *
 * The motion itself belongs to the consumers, via Reanimated's layout
 * animations. `LayoutAnimation` is legacy-architecture and unreliable under
 * Fabric, which this app runs by default.
 *
 * @internal
 */
import * as React from "react";

type CollapsibleContext = {
  readonly isOpen: (id: string) => boolean;
  readonly toggle: (id: string) => void;
};

const Context = React.createContext<CollapsibleContext | undefined>(undefined);

export const CollapsiblePartsProvider = (props: {
  /** Part id of the newest collapsible in the transcript, or undefined. */
  readonly newestID: string | undefined;
  readonly children: React.ReactNode;
}): React.ReactElement => {
  const [overrides, setOverrides] = React.useState<ReadonlyMap<string, boolean>>(new Map());

  const value = React.useMemo<CollapsibleContext>(() => {
    const isOpen = (id: string): boolean => overrides.get(id) ?? id === props.newestID;
    return {
      isOpen,
      toggle: (id: string) => {
        setOverrides((previous) => new Map(previous).set(id, !isOpen(id)));
      },
    };
  }, [overrides, props.newestID]);

  return <Context.Provider value={value}>{props.children}</Context.Provider>;
};

/**
 * Open state for one collapsible. Falls back to always-open when used outside
 * a provider, so a collapsible rendered somewhere without one degrades to
 * plain visible content rather than vanishing.
 */
export const useCollapsible = (id: string): { readonly open: boolean; readonly toggle: () => void } => {
  const context = React.useContext(Context);
  const [standalone, setStandalone] = React.useState(true);

  if (context === undefined) {
    return { open: standalone, toggle: () => setStandalone((o) => !o) };
  }
  return { open: context.isOpen(id), toggle: () => context.toggle(id) };
};
