import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn.js";

export const Separator = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("ui-separator", className)} role="separator" {...props} />
);
