/**
 * @module web/widget-registry
 *
 * Web card widget shape over the shared {@link ../ui/widgetRegistry | ui widget registry}.
 * Registry helpers (`forKind`, `widgetFor`, …) come from `hyperlink-ts/ui`; this file adds the
 * DOM card `Widget` / `WidgetProps` types and a typed `useWidgets` for card registries.
 *
 */
import type * as React from "react";
import type { LeafTag, WidgetRegistry as UiWidgetRegistry } from "../ui/widgetRegistry";
import { useWidgets as useWidgetsUi } from "../ui/widgetsContext";

/** Props every web card widget receives. @public */
export interface WidgetProps {
  readonly tag: LeafTag;
  readonly name: string;
  readonly onOpen: (tag: LeafTag) => void;
}

/** A DOM card component for one resource. @public */
export interface Widget {
  (props: WidgetProps): React.ReactElement;
}

/** Web card registry — ui registry specialized to {@link Widget}. @public */
export type WidgetRegistry = UiWidgetRegistry<Widget>;

/** Web card registry from context. @public */
export const useWidgets = (): WidgetRegistry => useWidgetsUi<Widget>();
