/**
 * @module tui/cellWidgets
 *
 * Ink grid cells + fallback-only {@link base} registry. Default cells come from
 * `View.react(tui/DashboardViews.layer)`. App overrides: Dashboard `views` /
 * `View.only` (not `forKey`).
 *
 */
import { Box, Text } from "ink";
import * as React from "react";
import { Option } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import * as Group from "../Group";
import * as WorkPoolView from "../ui/WorkPoolView";
import * as PriorityView from "../ui/PriorityView";
import * as DaemonView from "../ui/DaemonView";
import * as Observe from "../Observe";
import { kind as hyperlinkKind, kindOf as hyperlinkKindOf, nodeOf } from "../Hyperlink";
import {
  isDaemonTag,
  type DaemonTag,
  type GroupNode,
  type PriorityTag,
  type QueueTag,
} from "../ui/data";
import * as View from "../ui/View";
import { useAtomValue } from "../ui/atom-react";
import {
  emptyRegistry,
  isLeafTag,
  widgetFor,
  type WidgetRegistry,
} from "../ui/widgetRegistry";
import { useWidgets } from "../ui/widgetsContext";
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

const statusOf = (lifecycleTag: string): Status =>
  lifecycleTag === "Idle"
    ? "idle"
    : lifecycleTag === "Off"
      ? "off"
      : lifecycleTag === "Draining"
        ? "draining"
        : lifecycleTag === "Paused"
          ? "paused"
          : "running";

const lifecycleTagOf = (
  lifecycleR: AsyncResult.AsyncResult<{ readonly _tag: string }, unknown>,
): string =>
  AsyncResult.isSuccess(lifecycleR)
    ? lifecycleR.value._tag ?? "Running"
    : "Running";

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

/** WorkPool grid cell — also the TUI {@link View} card skin body. @public */
export const QueueCell = (props: {
  readonly name: string;
  readonly tag: QueueTag;
  /** Ink cell width; View kit omits this (uses a readable default). */
  readonly width?: number;
  readonly selected?: boolean;
}): React.ReactElement => {
  const { name, tag } = props;
  const width = props.width ?? 24;
  const selected = props.selected === true;
  const pack = Observe.use(tag, WorkPoolView.pack);
  const r = useAtomValue(pack.status);
  const lifecycleR = useAtomValue(pack.lifecycle);
  const opt = AsyncResult.isSuccess(r) ? r.value : Option.none();
  const s = Option.isSome(opt) ? opt.value : undefined;
  const sizes = s?.sizes ?? { high: 0, normal: 0, low: 0 };
  const lifecycleTag = lifecycleTagOf(lifecycleR);
  const status = statusOf(lifecycleTag);
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

/** `WorkPool.priority` grid cell. @public */
export const PriorityCell = (props: {
  readonly name: string;
  readonly tag: PriorityTag;
  readonly width: number;
  readonly selected: boolean;
}): React.ReactElement => {
  const { name, tag, width, selected } = props;
  const pack = Observe.use(tag, PriorityView.pack);
  const r = useAtomValue(pack.status);
  const lifecycleR = useAtomValue(pack.lifecycle);
  const opt = AsyncResult.isSuccess(r) ? r.value : Option.none();
  const s = Option.isSome(opt) ? opt.value : undefined;
  const lanes = s !== undefined ? Object.entries(s.sizes) : [];
  const pending = lanes.reduce((sum, [, n]) => sum + n, 0);
  const max = Math.max(1, ...lanes.map(([, n]) => n));
  const lifecycleTag = lifecycleTagOf(lifecycleR);
  const status = statusOf(lifecycleTag);
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

/** Daemon grid cell. @public */
export const DaemonCell = (props: {
  readonly name: string;
  readonly tag: DaemonTag;
  readonly width: number;
  readonly selected: boolean;
}): React.ReactElement => {
  const { name, tag, width, selected } = props;
  const r = useAtomValue(Observe.use(tag, DaemonView.pack).status);
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

/** Bare Hyperlink / unknown-kind grid cell. @public */
export const FallbackCell = (props: {
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

/**
 * Fallback-only TUI cell registry. Default cells come from
 * `View.react(tui/DashboardViews.layer)`. Prefer Dashboard `views` / `View.only`.
 *
 * @public
 */
export const base: TuiWidgetRegistry = emptyRegistry(fallbackWidget);

/** Dispatch a group member to its Ink cell (group, or registry leaf). @public */
export const Cell = (props: {
  readonly name: string;
  readonly member: unknown;
  readonly width: number;
  readonly selected: boolean;
}): React.ReactElement => {
  const registry = useWidgets<TuiCellWidget>();
  const runtime = useRuntime();
  const isGroup = Group.isGroup(props.member);
  const leaf = isLeafTag(props.member) ? props.member : null;
  const viewTag = isGroup ? props.member : leaf;
  const hasViewCard = View.useHasMatch(viewTag, View.ViewKind.Card());
  const Match = View.useMatch();
  // Group + leaf share kit Card when a family skin is on the layer (open stays parent / TUI focus).
  if (hasViewCard && viewTag !== null) {
    return (
      <View.ChromeProvider value={{ width: props.width, selected: props.selected }}>
        <Match.Card tag={viewTag} name={props.name} />
      </View.ChromeProvider>
    );
  }
  if (isGroup) {
    return (
      <GroupCell
        name={props.name}
        node={props.member}
        width={props.width}
        selected={props.selected}
      />
    );
  }
  if (leaf === null) {
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
    leaf.key,
    hyperlinkKindOf(leaf) ?? hyperlinkKind,
  );
  return (
    <Widget
      runtime={runtime}
      name={props.name}
      member={leaf}
      width={props.width}
      selected={props.selected}
    />
  );
};
