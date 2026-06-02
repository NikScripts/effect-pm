import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn.js";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: "default" | "secondary" | "ghost" | "outline" | "destructive";
  readonly size?: "default" | "sm" | "icon";
};

export const Button = ({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonProps) => (
  <button
    className={cn("ui-button", `ui-button--${variant}`, `ui-button--${size}`, className)}
    {...props}
  />
);
