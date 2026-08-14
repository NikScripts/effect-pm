/**
 * @module tui/focusWidgets
 *
 * Focused Priority / Daemon detail panes (Ink) — shared by {@link Dashboard} and
 * Dashboard View detail bodies (via internal components) avoid circular imports.
 */
import { Box, Text, useInput } from "ink";
import * as React from "react";
import { Option } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { nodeOf } from "../Hyperlink";
import {
  type CommandAtom,
  type DaemonTag,
  type PriorityTag,
} from "../ui/data";
import { useAtomSet, useAtomValue } from "../ui/atom-react";
import { spark } from "./chrome";
import * as PriorityView from "../ui/PriorityView";
import * as DaemonView from "../ui/DaemonView";
import * as Observe from "../Observe";
import {
  bar,
  BLANK_BORDER,
  COLOR,
  compact,
  displayName,
  STATUS_ICON,
  type Status,
} from "./queueWidget";

const LEVEL_COLOR: Record<string, string> = {
  Trace: "gray",
  Debug: "gray",
  Info: "white",
  Warning: "yellow",
  Error: "red",
  Fatal: "red",
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

/** Node bind mark for focused panes. @public */
export const NodeMark = (props: { readonly tag: unknown }): React.ReactElement | null => {
  const node = nodeOf(props.tag);
  if (node === undefined) return null;
  return <Text color="cyan"> ⬡ {displayName(node.key)}</Text>;
};

/** Edit-mode control key with pending/flash feedback. @public */
export const ControlKey = (props: {
  readonly k: string;
  readonly label: string;
  readonly atom: CommandAtom;
}): React.ReactElement => {
  const r = useAtomValue(props.atom);
  const pending = AsyncResult.isWaiting(r);
  const failed = AsyncResult.isFailure(r) && !pending;
  const [flash, setFlash] = React.useState(false);
  const wasPending = React.useRef(false);
  React.useEffect(() => {
    if (pending) {
      wasPending.current = true;
      return;
    }
    if (wasPending.current && AsyncResult.isSuccess(r)) {
      wasPending.current = false;
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 1500);
      return () => clearTimeout(t);
    }
    return;
  }, [pending, r]);
  const sym = pending ? " …" : flash ? " ✓" : failed ? " ✗" : "";
  const color = failed ? "red" : flash ? "green" : pending ? "yellow" : "gray";
  return (
    <Text color={color}>
      [{props.k}]{props.label}
      {sym}{" "}
    </Text>
  );
};

/** Live log tail for focused panes. @public */
export const LogTail = (props: {
  readonly logs: ReadonlyArray<{
    readonly id: number;
    readonly t: number;
    readonly level: string;
    readonly message: string;
  }>;
  readonly visible: number;
}): React.ReactElement => (
  <Box flexGrow={1} flexDirection="column" justifyContent="flex-end">
    {props.logs.slice(-props.visible).map((l) => (
      <Box key={l.id}>
        <Box width={11}>
          <Text dimColor>{new Date(l.t).toLocaleTimeString()}</Text>
        </Box>
        <Box width={6}>
          <Text color={LEVEL_COLOR[l.level] ?? "white"}>{l.level}</Text>
        </Box>
        <Box flexGrow={1}>
          <Text>{l.message}</Text>
        </Box>
      </Box>
    ))}
  </Box>
);

/** Focused `WorkPool.priority` detail (status + lanes + logs + edit chrome). @public */
export const FocusedPriority = (props: {
  readonly name: string;
  readonly tag: PriorityTag;
  readonly cols: number;
  readonly rows: number;
  readonly editMode?: boolean;
  readonly cmd?: string | null;
  readonly bar?: (hint: React.ReactElement) => React.ReactElement;
  readonly barRows?: number;
}): React.ReactElement => {
  const { name, tag, cols, rows } = props;
  const editMode = props.editMode ?? false;
  const cmd = props.cmd ?? null;
  const barRows = props.barRows ?? 0;
  const renderBar = props.bar ?? ((hint) => hint);
  const bundle = Observe.use(tag, PriorityView.pack);
  const statusR = useAtomValue(bundle.status);
  const lifecycleR = useAtomValue(bundle.lifecycle);
  const metricsR = useAtomValue(bundle.metrics);
  const logsR = useAtomValue(bundle.logs);
  const trendR = useAtomValue(bundle.trend);

  const start = useAtomSet(bundle.start);
  const pause = useAtomSet(bundle.pause);
  const resume = useAtomSet(bundle.resume);
  const clear = useAtomSet(bundle.clear);
  const stop = useAtomSet(bundle.stop);
  useInput(
    (input) => {
      if (input === "s") start();
      else if (input === "p") pause();
      else if (input === "r") resume();
      else if (input === "c") clear();
      else if (input === "x") stop();
    },
    { isActive: editMode && cmd === null },
  );

  const statusOpt = AsyncResult.isSuccess(statusR) ? statusR.value : Option.none();
  const s = Option.isSome(statusOpt) ? statusOpt.value : undefined;
  const metricsOpt = AsyncResult.isSuccess(metricsR) ? metricsR.value : Option.none();
  const m = Option.isSome(metricsOpt) ? metricsOpt.value : undefined;
  const trend = AsyncResult.isSuccess(trendR) ? trendR.value : [];
  const logs = AsyncResult.isSuccess(logsR) ? logsR.value : [];
  const lanes = s !== undefined ? Object.entries(s.sizes) : [];
  const pending = lanes.reduce((sum, [, n]) => sum + n, 0);
  const max = Math.max(1, ...lanes.map(([, n]) => n));
  const lifecycleTag = lifecycleTagOf(lifecycleR);
  const status = statusOf(lifecycleTag);
  const visible = Math.max(1, rows - 12 - barRows);
  const barWidth = Math.max(8, cols - 30);

  const hint = (
    <Box paddingX={1} backgroundColor="gray">
      <Text dimColor> Esc back · </Text>
      <Text color="cyan">:</Text>
      <Text dimColor> command · </Text>
      <Text color={editMode ? "red" : "gray"}>{editMode ? "EDIT " : "view "}</Text>
      {editMode ? (
        <>
          <ControlKey k="s" label="start" atom={bundle.start} />
          <ControlKey k="p" label="pause" atom={bundle.pause} />
          <ControlKey k="r" label="resume" atom={bundle.resume} />
          <ControlKey k="c" label="clear" atom={bundle.clear} />
          <ControlKey k="x" label="stop" atom={bundle.stop} />
        </>
      ) : (
        <Text dimColor>Ctrl+E edit</Text>
      )}
    </Box>
  );

  return (
    <Box
      flexDirection="column"
      width={cols}
      height={rows}
      borderStyle={editMode ? "double" : BLANK_BORDER}
      borderColor="red"
    >
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={COLOR[status]}
        paddingX={2}
        paddingY={1}
        marginX={1}
        marginTop={1}
      >
        <Box justifyContent="space-between">
          <Text bold color="cyan">
            {name}
            <NodeMark tag={tag} />
          </Text>
          <Text color={COLOR[status]}>
            {STATUS_ICON[status]} {status}
          </Text>
        </Box>
        <Box marginTop={1} justifyContent="space-between">
          <Text bold>PENDING {pending}</Text>
          <Text bold>COMPLETED {s?.completed ?? 0}</Text>
          <Text dimColor>
            {m?.throughputPerSec.toFixed(1) ?? "0.0"}/s · in-flight {s?.inFlight ?? 0}
          </Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          {lanes.slice(0, 8).map(([lane, count]) => (
            <Box key={lane}>
              <Box width={12}>
                <Text wrap="truncate">{lane}</Text>
              </Box>
              <Box width={barWidth + 1}>
                <Text>{bar(count, max, barWidth)}</Text>
              </Box>
              <Box width={6} justifyContent="flex-end">
                <Text>{compact(count)}</Text>
              </Box>
            </Box>
          ))}
        </Box>
        <Box marginTop={1}>
          <Text color="green">{spark(trend)}</Text>
          <Text dimColor> pending · last {trend.length}s</Text>
        </Box>
      </Box>
      <Box flexGrow={1} flexDirection="column" paddingX={1}>
        <Box>
          <Text dimColor>LOGS </Text>
          <Text color="green">live</Text>
        </Box>
        <LogTail logs={logs} visible={visible} />
      </Box>
      {renderBar(hint)}
    </Box>
  );
};

/** Focused Daemon detail (status + logs + edit chrome). @public */
export const FocusedDaemon = (props: {
  readonly name: string;
  readonly tag: DaemonTag;
  readonly cols: number;
  readonly rows: number;
  readonly editMode?: boolean;
  readonly cmd?: string | null;
  readonly bar?: (hint: React.ReactElement) => React.ReactElement;
  readonly barRows?: number;
}): React.ReactElement => {
  const { name, tag, cols, rows } = props;
  const editMode = props.editMode ?? false;
  const cmd = props.cmd ?? null;
  const barRows = props.barRows ?? 0;
  const renderBar = props.bar ?? ((hint) => hint);
  const bundle = Observe.use(tag, DaemonView.pack);
  const statusR = useAtomValue(bundle.status);
  const logsR = useAtomValue(bundle.logs);

  const start = useAtomSet(bundle.start);
  const stop = useAtomSet(bundle.stop);
  const runNow = useAtomSet(bundle.run);
  useInput(
    (input) => {
      if (input === "s") start();
      else if (input === "x") stop();
      else if (input === "n") runNow();
    },
    { isActive: editMode && cmd === null },
  );

  const s = AsyncResult.isSuccess(statusR) ? statusR.value : undefined;
  const logs = AsyncResult.isSuccess(logsR) ? logsR.value : [];
  const up = s?.supervising === true;
  const visible = Math.max(1, rows - 8 - barRows);

  const hint = (
    <Box paddingX={1} backgroundColor="gray">
      <Text dimColor> Esc back · </Text>
      <Text color="cyan">:</Text>
      <Text dimColor> command · </Text>
      <Text color={editMode ? "red" : "gray"}>{editMode ? "EDIT " : "view "}</Text>
      {editMode ? (
        <>
          <ControlKey k="s" label="start" atom={bundle.start} />
          <ControlKey k="x" label="stop" atom={bundle.stop} />
          <ControlKey k="n" label="run now" atom={bundle.run} />
        </>
      ) : (
        <Text dimColor>Ctrl+E edit</Text>
      )}
    </Box>
  );

  return (
    <Box
      flexDirection="column"
      width={cols}
      height={rows}
      borderStyle={editMode ? "double" : BLANK_BORDER}
      borderColor="red"
    >
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={up ? "green" : "gray"}
        paddingX={2}
        paddingY={1}
        marginX={1}
        marginTop={1}
      >
        <Box justifyContent="space-between">
          <Text bold color="cyan">
            ⚙ {name}
            <NodeMark tag={tag} />
          </Text>
          <Text color={up ? "green" : "gray"}>{up ? "► running" : "■ stopped"}</Text>
        </Box>
        <Box marginTop={1}>
          <Box width={24}>
            <Text>supervising {up ? "yes" : "no"}</Text>
          </Box>
          <Box width={20}>
            <Text>armed {s?.armed === true ? "yes" : "no"}</Text>
          </Box>
          <Box flexGrow={1}>
            <Text>active {s?.activeInstances ?? 0}</Text>
          </Box>
        </Box>
      </Box>
      <Box flexGrow={1} flexDirection="column" paddingX={1}>
        <Box>
          <Box flexGrow={1}>
            <Text dimColor>LOGS </Text>
            <Text color="green">live</Text>
          </Box>
        </Box>
        <LogTail logs={logs} visible={visible} />
      </Box>
      {renderBar(hint)}
    </Box>
  );
};
