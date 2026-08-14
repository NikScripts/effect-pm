/**
 * @module tui/queueWidget
 *
 * The queue widget — shared by every mock so they can't drift. Renders from a `View`
 * (the shape the real `.changes` + `.metrics` streams would produce) at four sizes:
 * S / M / L cards and the XL full page. `QueueWidget` picks by variant; `PageXL` is
 * exported directly for views that always want the full page (e.g. queue + logs).
 */

import { Box, Text } from "ink";
import * as React from "react";
import {
  bar,
  compact,
  displayName,
  fmt,
  spark,
  statusColor as COLOR,
  statusIcon as STATUS_ICON,
  blankBorder as BLANK_BORDER,
  type Status,
} from "./display";

export { bar, compact, displayName, fmt, spark, COLOR, STATUS_ICON, BLANK_BORDER };
export type { Status };

export type Priority = "high" | "normal" | "low";
export type Variant = "S" | "M" | "L" | "XL";

/** Everything the widget renders — `.changes` (status, sizes) + `.metrics` (rest). */
export interface View {
  readonly name: string;
  readonly status: Status;
  readonly sizes: Record<Priority, number>;
  readonly pending: number;
  readonly completed: number;
  readonly wait: Record<Priority, number>; // ms, per priority
  readonly execution: number; // ms, overall
  readonly total: number; // ms, overall
  readonly throughput: number; // per second
  readonly trend: ReadonlyArray<number>;
}

const SYM: Record<Priority, { symbol: string; color: string; label: string }> = {
  high: { symbol: "▲", color: "red", label: "high" },
  normal: { symbol: "•", color: "white", label: "normal" },
  low: { symbol: "▼", color: "blue", label: "low" },
};
export const variantFor = (cols: number, rows: number): Variant =>
  cols >= 78 && rows >= 18 ? "XL" : cols >= 48 ? "L" : cols >= 34 ? "M" : "S";

/** Fixed render height of the XL page — for layouts that pin it (e.g. queue + logs). */
export const PAGE_HEIGHT = 16;

const Title = (props: {
  readonly name: string;
  readonly status: Status;
}): React.ReactElement => (
  <Box justifyContent="space-between">
    <Text bold color="cyan">
      {displayName(props.name)}
    </Text>
    <Text color={COLOR[props.status]}>
      {STATUS_ICON[props.status]} {props.status}
    </Text>
  </Box>
);

const PrioRow = (props: {
  readonly p: Priority;
  readonly v: View;
  readonly barWidth: number;
  readonly max: number;
  readonly labelWidth: number;
  readonly showLabel: boolean;
  readonly waitWidth: number; // 0 hides the wait column
  readonly waitPrefix?: string;
}): React.ReactElement => {
  const s = SYM[props.p];
  const count = props.v.sizes[props.p];
  return (
    <Box>
      <Box width={props.labelWidth}>
        <Text wrap="truncate">
          {s.symbol}
          {props.showLabel ? ` ${s.label}` : ""}
        </Text>
      </Box>
      <Box width={props.barWidth + 1}>
        <Text color={s.color}>{bar(count, props.max, props.barWidth)}</Text>
      </Box>
      <Box width={5} justifyContent="flex-end">
        <Text>{compact(count)}</Text>
      </Box>
      {props.waitWidth > 0 ? (
        <Box width={props.waitWidth} justifyContent="flex-end">
          <Text dimColor>
            {props.waitPrefix ?? ""}~{fmt(props.v.wait[props.p])}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
};

export const CardS = (props: { readonly v: View }): React.ReactElement => {
  const { v } = props;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={COLOR[v.status]} paddingX={1} width={26}>
      <Title name={v.name} status={v.status} />
      <Box>
        <Box flexGrow={1}>
          <Text>{v.pending} pending</Text>
        </Box>
        <Text>{v.completed} ✓</Text>
      </Box>
      <Box>
        <Box flexGrow={1}>
          <Text>
            ▲{v.sizes.high} •{v.sizes.normal} ▼{v.sizes.low}
          </Text>
        </Box>
        <Text>{v.throughput.toFixed(1)}/s</Text>
      </Box>
    </Box>
  );
};

export const CardM = (props: { readonly v: View }): React.ReactElement => {
  const { v } = props;
  const max = Math.max(v.sizes.high, v.sizes.normal, v.sizes.low, 1);
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={COLOR[v.status]} paddingX={1} width={34}>
      <Title name={v.name} status={v.status} />
      <Box>
        <Box width={14}>
          <Text>pending {v.pending}</Text>
        </Box>
        <Box flexGrow={1} justifyContent="flex-end">
          <Text>{v.throughput.toFixed(1)}/s</Text>
        </Box>
      </Box>
      <PrioRow p="high" v={v} barWidth={4} max={max} labelWidth={2} showLabel={false} waitWidth={9} />
      <PrioRow p="normal" v={v} barWidth={4} max={max} labelWidth={2} showLabel={false} waitWidth={9} />
      <PrioRow p="low" v={v} barWidth={4} max={max} labelWidth={2} showLabel={false} waitWidth={9} />
      <Box>
        <Box width={14}>
          <Text dimColor>exec ~{fmt(v.execution)}</Text>
        </Box>
        <Box flexGrow={1} justifyContent="flex-end">
          <Text dimColor>✓ {v.completed}</Text>
        </Box>
      </Box>
    </Box>
  );
};

export const CardL = (props: { readonly v: View }): React.ReactElement => {
  const { v } = props;
  const max = Math.max(v.sizes.high, v.sizes.normal, v.sizes.low, 1);
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={COLOR[v.status]} paddingX={1} width={44}>
      <Title name={v.name} status={v.status} />
      <Box justifyContent="space-between">
        <Text>PENDING {v.pending}</Text>
        <Text>COMPLETED {v.completed}</Text>
      </Box>
      <PrioRow p="high" v={v} barWidth={7} max={max} labelWidth={8} showLabel waitWidth={14} waitPrefix="wait " />
      <PrioRow p="normal" v={v} barWidth={7} max={max} labelWidth={8} showLabel waitWidth={14} waitPrefix="wait " />
      <PrioRow p="low" v={v} barWidth={7} max={max} labelWidth={8} showLabel waitWidth={14} waitPrefix="wait " />
      <Box marginTop={1}>
        <Box width={15}>
          <Text dimColor>exec ~{fmt(v.execution)}</Text>
        </Box>
        <Box width={15}>
          <Text dimColor>total ~{fmt(v.total)}</Text>
        </Box>
        <Box flexGrow={1} justifyContent="flex-end">
          <Text dimColor>{v.throughput.toFixed(1)}/s</Text>
        </Box>
      </Box>
    </Box>
  );
};

export const PageXL = (props: {
  readonly v: View;
  readonly width: number;
}): React.ReactElement => {
  const { v } = props;
  const max = Math.max(v.sizes.high, v.sizes.normal, v.sizes.low, 1);
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={COLOR[v.status]}
      paddingX={2}
      paddingY={1}
      width={props.width}
      height={PAGE_HEIGHT}
    >
      <Title name={v.name} status={v.status} />
      <Box marginTop={1} justifyContent="space-between">
        <Text bold>PENDING {v.pending}</Text>
        <Text bold>COMPLETED {v.completed}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <PrioRow p="high" v={v} barWidth={20} max={max} labelWidth={9} showLabel waitWidth={16} waitPrefix="wait " />
        <PrioRow p="normal" v={v} barWidth={20} max={max} labelWidth={9} showLabel waitWidth={16} waitPrefix="wait " />
        <PrioRow p="low" v={v} barWidth={20} max={max} labelWidth={9} showLabel waitWidth={16} waitPrefix="wait " />
      </Box>
      <Box marginTop={1}>
        <Box width={22}>
          <Text>execution ~{fmt(v.execution)}</Text>
        </Box>
        <Box width={22}>
          <Text>total ~{fmt(v.total)}</Text>
        </Box>
        <Box flexGrow={1} justifyContent="flex-end">
          <Text>{v.throughput.toFixed(1)}/s</Text>
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text color="green">{spark(v.trend)}</Text>
        <Text dimColor> pending · last {v.trend.length}s</Text>
      </Box>
    </Box>
  );
};

/** Pick the variant; XL uses `cols` to size the page (capped). */
export const QueueWidget = (props: {
  readonly view: View;
  readonly variant: Variant;
  readonly cols: number;
}): React.ReactElement =>
  props.variant === "XL" ? (
    <PageXL v={props.view} width={Math.min(props.cols - 4, 96)} />
  ) : props.variant === "L" ? (
    <CardL v={props.view} />
  ) : props.variant === "M" ? (
    <CardM v={props.view} />
  ) : (
    <CardS v={props.view} />
  );
