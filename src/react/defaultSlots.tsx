/**
 * Default unstyled slot renderers (no Tailwind / shadcn).
 *
 * @module react/defaultSlots
 */

import type { ReactNode } from "react";
import type {
  ControlPanelActionButtonProps,
  ProcessRowSlotProps,
  QueueRowSlotProps,
} from "./slots.js";

/** @internal */
export const defaultActionButton = ({
  action,
  disabled,
  onClick,
}: ControlPanelActionButtonProps): ReactNode => (
  <button type="button" disabled={disabled} onClick={onClick}>
    {action}
  </button>
);

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
