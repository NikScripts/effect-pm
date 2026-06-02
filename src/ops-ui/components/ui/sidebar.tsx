import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn.js";

export const Sidebar = ({ className, ...props }: HTMLAttributes<HTMLElement>) => (
  <aside className={cn("ui-sidebar", className)} {...props} />
);

export const SidebarHeader = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("ui-sidebar-header", className)} {...props} />
);

export const SidebarContent = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("ui-sidebar-content", className)} {...props} />
);

export const SidebarGroup = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("ui-sidebar-group", className)} {...props} />
);
