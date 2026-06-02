import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn.js";

export const ScrollArea = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("ui-scroll-area", className)} {...props} />
);
