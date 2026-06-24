import * as React from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { cn } from "../../lib/utils";

export const ResizablePanelGroup = ({
  className,
  resizeTargetMinimumSize = { coarse: 20, fine: 10 },
  ...props
}: React.ComponentProps<typeof Group>): React.ReactElement => (
  <Group
    resizeTargetMinimumSize={resizeTargetMinimumSize}
    className={cn("h-full w-full", className)}
    {...props}
  />
);

export const ResizablePanel = Panel;

export const ResizableHandle = ({
  className,
  vertical = false,
  ...props
}: React.ComponentProps<typeof Separator> & { readonly vertical?: boolean }): React.ReactElement => (
  <Separator
    className={cn(
      "bg-border transition-colors hover:bg-ring data-[disabled]:opacity-50",
      vertical ? "h-px" : "w-px",
      className,
    )}
    {...props}
  />
);
