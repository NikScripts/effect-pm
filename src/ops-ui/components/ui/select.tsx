import type { SelectHTMLAttributes } from "react";
import { cn } from "../../lib/cn.js";

export const Select = ({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select className={cn("ui-select", className)} {...props} />
);
