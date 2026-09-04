/**
 * @module web/DashboardTopBar
 *
 * Public dashboard chrome — grid top bar + detail back/title strip. Shells compose these;
 * apps can reuse them outside {@link ./DashboardShell}.
 *
 * @public
 */
import * as React from "react";
import { Button } from "./components/ui/button";
import { useViewTransitionStyle } from "./useViewTransition";

/**
 * Grid-route top bar: optional back, title, trailing actions (count, NodeBar, …).
 *
 * @public
 */
export const DashboardTopBar = (props: {
  readonly title: string;
  /** When set, shows ← back and centers the title over the row. */
  readonly onBack?: () => void;
  /** Root route prefixes the title with ⬢. */
  readonly root?: boolean;
  readonly trailing?: React.ReactNode;
  readonly className?: string;
}): React.ReactElement => {
  const canBack = props.onBack !== undefined;
  return (
    <div className={props.className ?? "relative mb-4 flex items-center gap-2"}>
      {canBack ? (
        <>
          <Button variant="outline" size="sm" onClick={props.onBack}>
            ← back
          </Button>
          {/* centered to the row — absolute overlay; taps pass through to back/trailing */}
          <h1 className="pointer-events-none absolute inset-0 m-0 flex items-center justify-center truncate px-24 text-lg font-semibold">
            {props.title}
          </h1>
          <div className="flex-1" />
        </>
      ) : (
        <h1 className="m-0 flex-1 text-lg font-semibold">
          {props.root === false ? props.title : `⬢ ${props.title}`}
        </h1>
      )}
      {props.trailing}
    </div>
  );
};

/**
 * Detail-route chrome — back + title only; badges / body live in Detail skins (lock J).
 *
 * @public
 */
export const DashboardDetailChrome = (props: {
  readonly title: string;
  readonly onBack: () => void;
  readonly vtKey: string;
  readonly children: React.ReactNode;
  readonly className?: string;
}): React.ReactElement => {
  const vt = useViewTransitionStyle(props.vtKey);
  return (
    <div
      className={
        props.className ??
        "flex h-[100dvh] flex-col gap-3 overflow-hidden safe-area landscape:h-auto landscape:min-h-[100dvh] landscape:overflow-visible"
      }
      style={vt}
    >
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={props.onBack}>
          ← back
        </Button>
        <strong className="flex-1 truncate text-base">{props.title}</strong>
      </div>
      {props.children}
    </div>
  );
};
