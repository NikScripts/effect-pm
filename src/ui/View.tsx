/**
 * @module ui/View
 *
 * Re-export of `last-ts/View` — Effect DI components (`make` / Layer / mount).
 * Dashboard contribution surface: {@link ./Views}.
 *
 * Pane metadata for TUI/dashboard shells ({@link LayoutHints}) lives here on
 * Hyperlink — not on last-ts (codesplit: last-ts has no dashboard size/pane UI).
 */
"use client";

import * as React from "react";

export * from "last-ts/View";

/**
 * Pane / grid metadata for Hyperlink TUI and dashboard shells (width, selection, …).
 *
 * @public
 */
export interface LayoutHints {
  readonly width?: number;
  readonly selected?: boolean;
  /** TUI focused panes (Ink). */
  readonly cols?: number;
  readonly rows?: number;
  readonly editMode?: boolean;
}

const LayoutHintsContext = React.createContext<LayoutHints>({});

/**
 * Provide {@link LayoutHints} for descendant components.
 *
 * @public
 */
export const LayoutHintsProvider = (props: {
  readonly value: LayoutHints;
  readonly children: React.ReactNode;
}): React.ReactElement =>
  React.createElement(
    LayoutHintsContext.Provider,
    { value: props.value },
    props.children,
  );

/** Read parent {@link LayoutHints} (empty object when none). @public */
export const useLayoutHints = (): LayoutHints =>
  React.useContext(LayoutHintsContext);
