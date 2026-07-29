/**
 * @module tui/DashboardTopBar
 *
 * Public TUI dashboard chrome — crumb / title strip used by {@link ./DashboardShell}.
 *
 * @public
 */
import * as React from "react";
import { Box, Text } from "ink";

/**
 * Terminal top bar: cyan title chip + dim trailing status.
 *
 * @public
 */
export const DashboardTopBar = (props: {
  readonly title: string;
  readonly trailing?: React.ReactNode;
}): React.ReactElement => (
  <Box paddingX={1}>
    <Text bold color="black" backgroundColor="cyan">
      {` ⬢ ${props.title} `}
    </Text>
    {props.trailing}
  </Box>
);
