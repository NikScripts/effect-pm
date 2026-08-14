/**
 * @module ui/View
 *
 * Re-export of `last-ts/View` — Effect DI components (`make` / Layer / mount).
 * Dashboard contribution surface: {@link ./Views}.
 *
 * Pane / shell metadata ({@link Chrome}) lives here on Hyperlink — not on last-ts.
 */
"use client";

import * as React from "react";

export * from "last-ts/View";

/**
 * Pane / grid metadata for Hyperlink TUI and dashboard shells (width, selection, …).
 *
 * @public
 */
export interface Chrome {
  readonly width?: number;
  readonly selected?: boolean;
  /** TUI focused panes (Ink). */
  readonly cols?: number;
  readonly rows?: number;
  readonly editMode?: boolean;
}

const ChromeContext = React.createContext<Chrome>({});

/**
 * Provide {@link Chrome} for descendant components.
 *
 * @public
 */
export const ChromeProvider = (props: {
  readonly value: Chrome;
  readonly children: React.ReactNode;
}): React.ReactElement =>
  React.createElement(ChromeContext.Provider, { value: props.value }, props.children);

/** Read parent {@link Chrome} (empty object when none). @public */
export const useChrome = (): Chrome => React.useContext(ChromeContext);
