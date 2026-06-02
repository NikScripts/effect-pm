import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn.js";

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  readonly variant?: "default" | "secondary" | "outline" | "success" | "warning";
};

export const Badge = ({ className, variant = "default", ...props }: BadgeProps) => (
  <span className={cn("ui-badge", `ui-badge--${variant}`, className)} {...props} />
);
