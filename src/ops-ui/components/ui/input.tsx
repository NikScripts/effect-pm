import type { InputHTMLAttributes } from "react";
import { cn } from "../../lib/cn.js";

export const Input = ({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) => (
  <input className={cn("ui-input", className)} {...props} />
);
