/**
 * Default unstyled slot renderers (no Tailwind / shadcn).
 *
 * @module react/defaultSlots
 */

import type { ReactNode } from "react";
import type {
  ControlPanelActionButtonProps,
  LogRowSlotProps,
  ProcessRowSlotProps,
  QueueRowSlotProps,
} from "./slots.js";

const actionLabel = (
  action: ControlPanelActionButtonProps["action"],
): string => {
  switch (action) {
    case "start":
      return "Start";
    case "stop":
      return "Stop";
    case "restart":
      return "Restart";
    case "now":
      return "Run now";
    case "pause":
      return "Pause";
    case "resume":
      return "Resume";
    case "clear":
      return "Clear";
  }
};

const actionIcon = (
  action: ControlPanelActionButtonProps["action"],
): ReactNode => {
  switch (action) {
    case "start":
    case "resume":
      return <path d="M8 5v14l11-7z" />;
    case "stop":
      return <path d="M7 7h10v10H7z" />;
    case "restart":
      return <path d="M17 7a7 7 0 1 0 1.9 6.3h-2.2A5 5 0 1 1 15.6 8.4L13 11h7V4z" />;
    case "now":
      return <path d="M13 2 4 14h7l-1 8 10-13h-7z" />;
    case "pause":
      return <><path d="M7 5h4v14H7z" /><path d="M13 5h4v14h-4z" /></>;
    case "clear":
      return <path d="M7 7h10l-.8 13H7.8zm2-4h6l1 2h4v2H4V5h4zm1 6v9h2V9zm4 0v9h2V9z" />;
  }
};

/** @internal */
export const defaultActionButton = ({
  action,
  disabled,
  onClick,
}: ControlPanelActionButtonProps): ReactNode => {
  const label = actionLabel(action);
  return (
    <button
      type="button"
      aria-label={label}
      className="pm-action-button"
      data-pm-action={action}
      disabled={disabled}
      onClick={onClick}
      title={label}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
        {actionIcon(action)}
      </svg>
    </button>
  );
};

/** @internal */
export const defaultProcessRow = ({ process, uptimeLabel, actions }: ProcessRowSlotProps): ReactNode => (
  <li>
    <strong>{process.name}</strong>
    <span>
      {" "}
      — {process.status} · {uptimeLabel}
    </span>
    <div>{actions}</div>
  </li>
);

/** @internal */
export const defaultQueueRow = ({ queue, sizeLabel, actions }: QueueRowSlotProps): ReactNode => (
  <li>
    <strong>{queue.name}</strong>
    <span>
      {" "}
      — {sizeLabel} · completed {String(queue.completed)}
    </span>
    <div>{actions}</div>
  </li>
);

/** @internal */
export const defaultLogRow = ({ entry }: LogRowSlotProps): ReactNode => (
  <li>
    <time dateTime={entry.date}>{entry.date}</time>
    <span> [{entry.level}] </span>
    <span>{entry.message}</span>
  </li>
);
