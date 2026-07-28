/**
 * @module tui/cellWidgets
 *
 * Ink grid cells + the built-in {@link base} widget registry. Same key→kind→fallback
 * resolution as `hyperlink-ts/web` (`forKind` / `forKey` / `withEntries` from `hyperlink-ts/ui`).
 *
 */
import { Box, Text } from "ink";
import * as React from "react";
import { Option } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import * as Group from "../Group";
import { kind as hyperlinkKind, kindOf as hyperlinkKindOf, nodeOf } from "../Hyperlink";
import { kind as queueKind, priorityKind } from "../WorkPool";
import { kind as daemonKind } from "../Daemon";
import { httpApiClientKind as apiKind } from "../Gate";
import { kind as fleetHealthKind } from "../FleetHealth";
import { kind as telemetryKind } from "../Telemetry";
import { kind as shardMapKind } from "../ShardMap";
import { kind as gateKind } from "../Gate";
import {
  daemonBundle,
  isApiTag,
  isDaemonTag,
  isFleetHealthTag,
  isGateTag,
  isPriorityTag,
  isQueueTag,
  isShardMapTag,
  isTelemetryTag,
  priorityBundle,
  queueBundle,
  type DaemonTag,
  type GroupNode,
  type PriorityTag,
  type QueueTag,
} from "../ui/data";
import { memberKindOf } from "../ui/memberKind";
import { useAtomValue } from "../ui/atom-react";
import {
  emptyRegistry,
  forKind,
  isLeafTag,
  widgetFor,
  withEntries,
  type WidgetRegistry,
} from "../ui/widgetRegistry";
import { useWidgets } from "../ui/widgetsContext";
import {
  ApiCell,
  FleetHealthCell,
  GateCell,
  ShardMapCell,
  TelemetryCell,
} from "./kindCells";
import { useRuntime, type AnyRuntime } from "./runtime";
import {
  bar,
  COLOR,
  compact,
  displayName,
  STATUS_ICON,
  type Priority,
  type Status,
} from "./queueWidget";

const CELL_HEIGHT = 7;
const SYM: Record<Priority, { symbol: string; color: string }> = {
  high: { symbol: "▲", color: "red" },
  normal: { symbol: "•", color: "white" },
  low: { symbol: "▼", color: "blue" },
};

const statusOf = (phase: string, paused: boolean): Status =>
  phase === "off" ? "off" : phase === "draining" ? "draining" : paused ? "paused" : "running";

const leafCountOf = (node: GroupNode): number =>
  Object.values(Group.members(node)).reduce<number>(
    (n, m) => n + (Group.isGroup(m) ? leafCountOf(m) : 1),
    0,
  );

const NodeMark = (props: { readonly tag: unknown }): React.ReactElement | null => {
  const node = nodeOf(props.tag);
  if (node === undefined) return null;
  return <Text color="cyan"> ⬡ {displayName(node.key)}</Text>;
};

const PrioRow = (props: {
  readonly p: Priority;
  readonly count: number;
  readonly max: number;
  readonly barWidth: number;
}): React.ReactElement => {
  const s = SYM[props.p];
  return (
    <Box>
      <Box width={2}>
        <Text>{s.symbol}</Text>
      </Box>
      <Box width={props.barWidth + 1}>
        <Text color={s.color}>{bar(props.count, props.max, props.barWidth)}</Text>
      </Box>
      <Box width={5} justifyContent="flex-end">
        <Text>{compact(props.count)}</Text>
      </Box>
    </Box>
  );
};

/** Props every TUI grid cell widget receives. @public */
export interface TuiCellProps {
  readonly runtime: AnyRuntime;
  readonly name: string;
  readonly member: unknown;
  readonly width: number;
  readonly selected: boolean;
}

/** An Ink grid cell for one HyperService (or fallback). @public */
export type TuiCellWidget = (props: TuiCellProps) => React.ReactElement;

/** TUI cell registry. @public */
export type TuiWidgetRegistry = WidgetRegistry<TuiCellWidget>;

const QueueCell = (props: {
  readonly name: string;
  readonly tag: QueueTag;
  readonly width: number;
  readonly selected: boolean;
}): React.ReactElement => {
  const { name, tag, width, selected } = props;
  const r = useAtomValue(queueBundle(useRuntime(), tag).status);
  const opt = AsyncResult.isSuccess(r) ? r.value : Option.none();
  const s = Option.isSome(opt) ? opt.value : undefined;
  const sizes = s?.sizes ?? { high: 0, normal: 0, low: 0 };
  const status = statusOf(s?.phase ?? "running", s?.paused ?? false);
  const pending = sizes.high + sizes.normal + sizes.low;
  const max = Math.max(sizes.high, sizes.normal, sizes.low, 1);
  const barWidth = Math.max(4, width - 4 - 2 - 1 - 5);
  return (
    <Box
      flexDirection="column"
      borderStyle={selected ? "double" : "round"}
      borderColor={selected ? "green" : COLOR[status]}
      height={CELL_HEIGHT}
      width={width}
      marginRight={1}
      marginBottom={1}
      paddingX={1}
    >
      <Box>
        <Box flexGrow={1}>
          <Text bold wrap="truncate">
            {name}
          </Text>
          <NodeMark tag={tag} />
        </Box>
        <Text color={COLOR[status]}>{STATUS_ICON[status]}</Text>
      </Box>
      <Box>
        <Box flexGrow={1}>
          <Text>pending {compact(pending)}</Text>
        </Box>
        <Text dimColor>{compact(s?.completed ?? 0)} ✓</Text>
      </Box>
      <PrioRow p="high" count={sizes.high} max={max} barWidth={barWidth} />
      <PrioRow p="normal" count={sizes.normal} max={max} barWidth={barWidth} />
      <PrioRow p="low" count={sizes.low} max={max} barWidth={barWidth} />
    </Box>
  );
};

const PriorityCell = (props: {
  readonly name: string;
  readonly tag: PriorityTag;
  readonly width: number;
  readonly selected: boolean;
}): React.ReactElement => {
  const { name, tag, width, selected } = props;
  const r = useAtomValue(priorityBundle(useRuntime(), tag).status);
  const opt = AsyncResult.isSuccess(r) ? r.value : Option.none();
  const s = Option.isSome(opt) ? opt.value : undefined;
  const lanes = s !== undefined ? Object.entries(s.sizes) : [];
  const pending = lanes.reduce((sum, [, n]) => sum + n, 0);
  const max = Math.max(1, ...lanes.map(([, n]) => n));
  const status = statusOf(s?.phase ?? "running", s?.paused ?? false);
  const barWidth = Math.max(4, width - 4 - 2 - 1 - 5);
  return (
    <Box
      flexDirection="column"
      borderStyle={selected ? "double" : "round"}
      borderColor={selected ? "green" : COLOR[status]}
      height={CELL_HEIGHT}
      width={width}
      marginRight={1}
      marginBottom={1}
      paddingX={1}
    >
      <Box>
        <Box flexGrow={1}>
          <Text bold wrap="truncate">
            {name}
          </Text>
          <NodeMark tag={tag} />
        </Box>
        <Text color={COLOR[status]}>{STATUS_ICON[status]}</Text>
      </Box>
      <Box>
        <Box flexGrow={1}>
          <Text>pending {compact(pending)}</Text>
        </Box>
        <Text dimColor>{compact(s?.completed ?? 0)} ✓</Text>
      </Box>
      {lanes.slice(0, 3).map(([lane, count]) => (
        <Box key={lane}>
          <Box width={2}>
            <Text dimColor>•</Text>
          </Box>
          <Box width={barWidth + 1}>
            <Text>{bar(count, max, barWidth)}</Text>
          </Box>
          <Box width={5} justifyContent="flex-end">
            <Text>{compact(count)}</Text>
          </Box>
        </Box>
      ))}
    </Box>
  );
};

const DaemonCell = (props: {
  readonly name: string;
  readonly tag: DaemonTag;
  readonly width: number;
  readonly selected: boolean;
}): React.ReactElement => {
  const { name, tag, width, selected } = props;
  const r = useAtomValue(daemonBundle(useRuntime(), tag).status);
  const s = AsyncResult.isSuccess(r) ? r.value : undefined;
  const up = s?.supervising === true;
  return (
    <Box
      flexDirection="column"
      borderStyle={selected ? "double" : "round"}
      borderColor={selected ? "green" : up ? "green" : "gray"}
      height={CELL_HEIGHT}
      width={width}
      marginRight={1}
      marginBottom={1}
      paddingX={1}
    >
      <Box>
        <Box flexGrow={1}>
          <Text bold wrap="truncate">
            ⚙ {name}
          </Text>
          <NodeMark tag={tag} />
        </Box>
        <Text color={up ? "green" : "gray"}>{up ? "►" : "■"}</Text>
      </Box>
      <Box>
        <Box flexGrow={1}>
          <Text>{up ? "running" : "stopped"}</Text>
        </Box>
        <Text dimColor>{s?.armed === true ? "armed" : "disarmed"}</Text>
      </Box>
      <Box marginTop={1}>
        <Text>active </Text>
        <Text bold>{s?.activeInstances ?? 0}</Text>
      </Box>
    </Box>
  );
};

/** Subgroup cell — not in the leaf registry (groups are dispatched before `widgetFor`). @public */
export const GroupCell = (props: {
  readonly name: string;
  readonly node: GroupNode;
  readonly width: number;
  readonly selected: boolean;
}): React.ReactElement => {
  const { name, node, width, selected } = props;
  const members = Object.entries(Group.members(node));
  const leafCount = leafCountOf(node);
  return (
    <Box
      flexDirection="column"
      borderStyle={selected ? "double" : "round"}
      borderColor={selected ? "green" : "cyan"}
      height={CELL_HEIGHT}
      width={width}
      marginRight={1}
      marginBottom={1}
      paddingX={1}
    >
      <Box>
        <Box flexGrow={1}>
          <Text bold color="cyan" wrap="truncate">
            ▸ {name}
          </Text>
        </Box>
        <Text dimColor>{leafCount}</Text>
      </Box>
      {width >= 22
        ? members.slice(0, 4).map(([childName, m]) => (
            <Text key={`${name}-${childName}`} dimColor wrap="truncate">
              {Group.isGroup(m) ? "▸ " : isDaemonTag(m) ? "⚙ " : "  "}
              {childName}
            </Text>
          ))
        : null}
    </Box>
  );
};

const FallbackCell = (props: {
  readonly name: string;
  readonly member?: unknown;
  readonly width: number;
  readonly selected: boolean;
}): React.ReactElement => {
  const kind = props.member !== undefined ? hyperlinkKindOf(props.member) : undefined;
  const node = props.member !== undefined ? nodeOf(props.member) : undefined;
  return (
    <Box
      flexDirection="column"
      borderStyle={props.selected ? "double" : "round"}
      borderColor={props.selected ? "green" : "gray"}
      height={CELL_HEIGHT}
      width={props.width}
      marginRight={1}
      marginBottom={1}
      paddingX={1}
    >
      <Text bold wrap="truncate">
        {props.name}
      </Text>
      <Text dimColor wrap="truncate">
        {kind !== undefined ? displayName(kind) : "resource"}
      </Text>
      {node !== undefined ? (
        <Text dimColor wrap="truncate">
          ⬡ {displayName(node.key)}
        </Text>
      ) : null}
    </Box>
  );
};

const fallbackWidget: TuiCellWidget = ({ name, member, width, selected }) => (
  <FallbackCell name={name} member={member} width={width} selected={selected} />
);

const queueWidget: TuiCellWidget = ({ name, member, width, selected }) =>
  isQueueTag(member) ? (
    <QueueCell name={name} tag={member} width={width} selected={selected} />
  ) : (
    <FallbackCell name={name} member={member} width={width} selected={selected} />
  );

const priorityWidget: TuiCellWidget = ({ name, member, width, selected }) =>
  isPriorityTag(member) ? (
    <PriorityCell name={name} tag={member} width={width} selected={selected} />
  ) : (
    <FallbackCell name={name} member={member} width={width} selected={selected} />
  );

const daemonWidget: TuiCellWidget = ({ name, member, width, selected }) =>
  isDaemonTag(member) ? (
    <DaemonCell name={name} tag={member} width={width} selected={selected} />
  ) : (
    <FallbackCell name={name} member={member} width={width} selected={selected} />
  );

const gateWidget: TuiCellWidget = ({ runtime, name, member, width, selected }) =>
  isGateTag(member) ? (
    <GateCell runtime={runtime} name={name} tag={member} width={width} selected={selected} />
  ) : (
    <FallbackCell name={name} member={member} width={width} selected={selected} />
  );

const apiWidget: TuiCellWidget = ({ runtime, name, member, width, selected }) =>
  isApiTag(member) ? (
    <ApiCell runtime={runtime} name={name} tag={member} width={width} selected={selected} />
  ) : (
    <FallbackCell name={name} member={member} width={width} selected={selected} />
  );

const fleetHealthWidget: TuiCellWidget = ({ runtime, name, member, width, selected }) =>
  isFleetHealthTag(member) ? (
    <FleetHealthCell runtime={runtime} name={name} tag={member} width={width} selected={selected} />
  ) : (
    <FallbackCell name={name} member={member} width={width} selected={selected} />
  );

const telemetryWidget: TuiCellWidget = ({ runtime, name, member, width, selected }) =>
  isTelemetryTag(member) ? (
    <TelemetryCell runtime={runtime} name={name} tag={member} width={width} selected={selected} />
  ) : (
    <FallbackCell name={name} member={member} width={width} selected={selected} />
  );

const shardMapWidget: TuiCellWidget = ({ runtime, name, member, width, selected }) =>
  isShardMapTag(member) ? (
    <ShardMapCell runtime={runtime} name={name} tag={member} width={width} selected={selected} />
  ) : (
    <FallbackCell name={name} member={member} width={width} selected={selected} />
  );

/**
 * Built-in TUI cell set. Default for `<Dashboard>`; extend with
 * `withEntries(base, [forKind(...), forKey(...)])`.
 *
 * @public
 */
export const base: TuiWidgetRegistry = withEntries(emptyRegistry(fallbackWidget), [
  forKind(queueKind, queueWidget),
  forKind(priorityKind, priorityWidget),
  forKind(daemonKind, daemonWidget),
  forKind(apiKind, apiWidget),
  forKind(fleetHealthKind, fleetHealthWidget),
  forKind(telemetryKind, telemetryWidget),
  forKind(shardMapKind, shardMapWidget),
  forKind(gateKind, gateWidget),
  forKind(hyperlinkKind, fallbackWidget),
]);

/** Dispatch a group member to its Ink cell (group, or registry leaf). @public */
export const Cell = (props: {
  readonly name: string;
  readonly member: unknown;
  readonly width: number;
  readonly selected: boolean;
}): React.ReactElement => {
  const registry = useWidgets<TuiCellWidget>();
  const runtime = useRuntime();
  if (memberKindOf(props.member) === "group" && Group.isGroup(props.member)) {
    return (
      <GroupCell
        name={props.name}
        node={props.member}
        width={props.width}
        selected={props.selected}
      />
    );
  }
  if (!isLeafTag(props.member)) {
    return (
      <FallbackCell
        name={props.name}
        member={props.member}
        width={props.width}
        selected={props.selected}
      />
    );
  }
  const Widget = widgetFor(
    registry,
    props.member.key,
    hyperlinkKindOf(props.member) ?? hyperlinkKind,
  );
  return (
    <Widget
      runtime={runtime}
      name={props.name}
      member={props.member}
      width={props.width}
      selected={props.selected}
    />
  );
};
