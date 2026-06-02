import type { ButtonHTMLAttributes, HTMLAttributes } from "react";
import { cn } from "../../lib/cn.js";

export const TabsList = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("ui-tabs-list", className)} role="tablist" {...props} />
);

export const TabsTrigger = ({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button className={cn("ui-tabs-trigger", className)} role="tab" type="button" {...props} />
);
