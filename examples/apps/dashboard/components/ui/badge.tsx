import * as React from "react";
import { cn } from "../../lib/utils";

export const Badge = ({
  className,
  color,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { readonly color?: string }): React.ReactElement => (
  <span
    className={cn(
      "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
      className,
    )}
    style={color === undefined ? undefined : { color, borderColor: color }}
    {...props}
  />
);
