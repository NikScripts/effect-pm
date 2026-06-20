import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn.js";

export const Menubar = ({ className, ...props }: HTMLAttributes<HTMLElement>) => (
  <nav className={cn("ui-menubar", className)} {...props} />
);
