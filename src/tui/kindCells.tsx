/**
 * @module tui/kindCells
 *
 * Ink grid/detail chrome for gate, api, fleet-health, telemetry, and shard-map.
 * Data from `hyperlink-ts/ui` bundles; nicknames from the parent Group.
 *
 */
import { Box, Text } from "ink";
import * as React from "react";
import { Option } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import {
  type ApiTag,
  type FleetHealthTag,
  type GateTag,
  type ShardMapTag,
  type TelemetryTag,
} from "../ui/data";
import { useAtomValue } from "../ui/atom-react";
import * as GateView from "../ui/GateView";
import * as ApiMetricsView from "../ui/ApiMetricsView";
import * as FleetHealthView from "../ui/FleetHealthView";
import * as TelemetryView from "../ui/TelemetryView";
import * as ShardMapView from "../ui/ShardMapView";
import * as Observe from "../Observe";
import { bar, blankBorder as BLANK_BORDER, compact, displayName, spark } from "./chrome";


const CELL_HEIGHT = 7;

const CellShell = (props: {
  readonly selected: boolean;
  readonly width: number;
  readonly borderColor: string;
  readonly children: React.ReactNode;
}): React.ReactElement => (
  <Box
    flexDirection="column"
    borderStyle={props.selected ? "double" : "round"}
    borderColor={props.selected ? "green" : props.borderColor}
    height={CELL_HEIGHT}
    width={props.width}
    marginRight={1}
    marginBottom={1}
    paddingX={1}
  >
    {props.children}
  </Box>
);

const NodeRows = (props: {
  readonly rows: ReadonlyArray<readonly [string, number]>;
  readonly max: number;
  readonly barWidth: number;
}): React.ReactElement => (
  <>
    {props.rows.slice(0, 3).map(([node, n]) => (
      <Box key={node}>
        <Box width={8}>
          <Text dimColor wrap="truncate">
            {displayName(node)}
          </Text>
        </Box>
        <Box width={props.barWidth + 1}>
          <Text color="cyan">{bar(n, props.max, props.barWidth)}</Text>
        </Box>
        <Box width={5} justifyContent="flex-end">
          <Text>{compact(n)}</Text>
        </Box>
      </Box>
    ))}
  </>
);

const backHint = (
  <Box paddingX={1} backgroundColor="gray">
    <Text dimColor> Esc back · read-only</Text>
  </Box>
);

const FocusChrome = (props: {
  readonly cols: number;
  readonly rows: number;
  readonly title: string;
  readonly borderColor: string;
  readonly children: React.ReactNode;
}): React.ReactElement => (
  <Box flexDirection="column" width={props.cols} height={props.rows} borderStyle={BLANK_BORDER}>
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={props.borderColor}
      paddingX={2}
      paddingY={1}
      marginX={1}
      marginTop={1}
    >
      <Text bold color="cyan">
        {props.title}
      </Text>
      <Box marginTop={1} flexDirection="column">
        {props.children}
      </Box>
    </Box>
    <Box flexGrow={1} />
    {backHint}
  </Box>
);

export const GateCell = (props: {
  readonly name: string;
  readonly tag: GateTag;
  readonly width: number;
  readonly selected: boolean;
}): React.ReactElement => {
  const r = useAtomValue(Observe.use(props.tag, GateView.pack).status);
  const s = AsyncResult.isSuccess(r) ? r.value : undefined;
  const inFlight = s?.inFlight ?? 0;
  const waiting = s?.waiting ?? 0;
  const concurrency = s?.concurrency ?? 0;
  const barWidth = Math.max(4, props.width - 8);
  return (
    <CellShell selected={props.selected} width={props.width} borderColor="blue">
      <Box>
        <Box flexGrow={1}>
          <Text bold wrap="truncate">
            {props.name}
          </Text>
        </Box>
        <Text dimColor>lim {concurrency}</Text>
      </Box>
      <Box>
        <Text>
          in-flight <Text bold>{inFlight}</Text>
        </Text>
        <Box flexGrow={1} />
        <Text dimColor>{waiting} wait</Text>
      </Box>
      <Text color="cyan">{bar(inFlight, Math.max(1, concurrency), barWidth)}</Text>
      <Box>
        <Text color="green">{compact(s?.completed ?? 0)} ✓</Text>
        <Text> </Text>
        <Text color="red">{compact(s?.failed ?? 0)} ✗</Text>
        <Text> </Text>
        <Text dimColor>{compact(s?.interrupted ?? 0)} ∥</Text>
      </Box>
    </CellShell>
  );
};

export const FocusedGate = (props: {
  readonly name: string;
  readonly tag: GateTag;
  readonly cols: number;
  readonly rows: number;
}): React.ReactElement => {
  const r = useAtomValue(Observe.use(props.tag, GateView.pack).status);
  const s = AsyncResult.isSuccess(r) ? r.value : undefined;
  const completed = s?.completed ?? 0;
  const avgMs =
    completed > 0 && s !== undefined ? Math.round(s.totalDurationMs / completed) : undefined;
  return (
    <FocusChrome cols={props.cols} rows={props.rows} title={props.name} borderColor="blue">
      <Text>
        concurrency {s?.concurrency ?? 0} · in-flight {s?.inFlight ?? 0} · waiting {s?.waiting ?? 0}
      </Text>
      <Text>
        done {s?.completed ?? 0} · failed {s?.failed ?? 0} · interrupted {s?.interrupted ?? 0}
        {avgMs !== undefined ? ` · avg ${avgMs}ms` : ""}
      </Text>
      <Box marginTop={1}>
        <Text color="cyan">
          {bar(s?.inFlight ?? 0, Math.max(1, s?.concurrency ?? 1), Math.max(8, props.cols - 20))}
        </Text>
      </Box>
    </FocusChrome>
  );
};

export const ApiCell = (props: {
  readonly name: string;
  readonly tag: ApiTag;
  readonly width: number;
  readonly selected: boolean;
}): React.ReactElement => {
  const bundle = Observe.use(props.tag, ApiMetricsView.pack);
  const statusR = useAtomValue(bundle.status);
  const metricsR = useAtomValue(bundle.metrics);
  const historyR = useAtomValue(bundle.history);
  const remainingR = useAtomValue(bundle.remaining);
  const exceededR = useAtomValue(bundle.exceeded);
  const s = AsyncResult.isSuccess(statusR) ? statusR.value : undefined;
  const m = AsyncResult.isSuccess(metricsR)
    ? Option.isSome(metricsR.value)
      ? metricsR.value.value
      : undefined
    : undefined;
  const history = AsyncResult.isSuccess(historyR) ? historyR.value : [];
  const remaining = AsyncResult.isSuccess(remainingR) ? remainingR.value : 0;
  const exceeded = AsyncResult.isSuccess(exceededR) ? exceededR.value : 0;
  return (
    <CellShell selected={props.selected} width={props.width} borderColor="magenta">
      <Box>
        <Box flexGrow={1}>
          <Text bold wrap="truncate">
            {props.name}
          </Text>
        </Box>
        <Text dimColor>api</Text>
      </Box>
      <Box>
        <Text>{(m?.throughputPerSec ?? 0).toFixed(1)}/s</Text>
        <Box flexGrow={1} />
        <Text dimColor>in-flight {s?.inFlight ?? 0}</Text>
      </Box>
      <Text>
        req {compact(s?.requestsTotal ?? 0)} · err {compact(s?.errorsTotal ?? 0)} · rem{" "}
        {compact(remaining)} · xcd {compact(exceeded)}
      </Text>
      <Text color="green">{spark(history.map((p) => p.throughput))}</Text>
    </CellShell>
  );
};

export const FocusedApi = (props: {
  readonly name: string;
  readonly tag: ApiTag;
  readonly cols: number;
  readonly rows: number;
}): React.ReactElement => {
  const bundle = Observe.use(props.tag, ApiMetricsView.pack);
  const statusR = useAtomValue(bundle.status);
  const metricsR = useAtomValue(bundle.metrics);
  const historyR = useAtomValue(bundle.history);
  const remainingR = useAtomValue(bundle.remaining);
  const resetAfterR = useAtomValue(bundle.resetAfter);
  const exceededR = useAtomValue(bundle.exceeded);
  const s = AsyncResult.isSuccess(statusR) ? statusR.value : undefined;
  const m = AsyncResult.isSuccess(metricsR)
    ? Option.isSome(metricsR.value)
      ? metricsR.value.value
      : undefined
    : undefined;
  const history = AsyncResult.isSuccess(historyR) ? historyR.value : [];
  const remaining = AsyncResult.isSuccess(remainingR) ? remainingR.value : 0;
  const resetAfter = AsyncResult.isSuccess(resetAfterR) ? resetAfterR.value : 0;
  const exceeded = AsyncResult.isSuccess(exceededR) ? exceededR.value : 0;
  const endpoints = [...(m?.byEndpoint ?? [])].slice(0, 12);
  const maxReq = Math.max(1, ...endpoints.map((e) => e.requests));
  return (
    <FocusChrome cols={props.cols} rows={props.rows} title={props.name} borderColor="magenta">
      <Text>
        {(m?.throughputPerSec ?? 0).toFixed(1)} req/s · in-flight {s?.inFlight ?? 0} · total{" "}
        {compact(s?.requestsTotal ?? 0)} · errors {compact(s?.errorsTotal ?? 0)} · rem{" "}
        {compact(remaining)} · reset {resetAfter > 0 ? `${Math.round(resetAfter)}ms` : "—"} · xcd{" "}
        {compact(exceeded)}
      </Text>
      <Text color="green">{spark(history.map((p) => p.throughput))}</Text>
      <Box marginTop={1} flexDirection="column">
        {endpoints.map((e, i) => (
          <Box key={`${e.endpoint}-${i}`}>
            <Box width={Math.min(40, props.cols - 20)}>
              <Text wrap="truncate">{e.endpoint}</Text>
            </Box>
            <Text color="cyan">{bar(e.requests, maxReq, 12)}</Text>
            <Text> {e.requests}</Text>
          </Box>
        ))}
      </Box>
    </FocusChrome>
  );
};

export const FleetHealthCell = (props: {
  readonly name: string;
  readonly tag: FleetHealthTag;
  readonly width: number;
  readonly selected: boolean;
}): React.ReactElement => {
  const bundle = Observe.use(props.tag, FleetHealthView.pack);
  const statusR = useAtomValue(bundle.status);
  const byNodeR = useAtomValue(bundle.byNode);
  const status = AsyncResult.isSuccess(statusR) ? statusR.value : undefined;
  const byNode = AsyncResult.isSuccess(byNodeR) ? byNodeR.value : {};
  const rows = Object.entries(byNode).sort(([a], [b]) => a.localeCompare(b));
  const color =
    status === "ok" ? "green" : status === "degraded" || status === "partial" ? "yellow" : "gray";
  return (
    <CellShell selected={props.selected} width={props.width} borderColor={color}>
      <Box>
        <Box flexGrow={1}>
          <Text bold wrap="truncate">
            {props.name}
          </Text>
        </Box>
        <Text color={color}>{status ?? "…"}</Text>
      </Box>
      {rows.slice(0, 4).map(([node, report]) => (
        <Text key={node} dimColor wrap="truncate">
          {displayName(node)} {fleetNodeLabel(report)}
        </Text>
      ))}
    </CellShell>
  );
};

const fleetNodeLabel = (report: { readonly _tag: string; readonly status?: string }): string =>
  report._tag === "Reachable" && report.status !== undefined
    ? `${report._tag} · ${report.status}`
    : report._tag;

export const FocusedFleetHealth = (props: {
  readonly name: string;
  readonly tag: FleetHealthTag;
  readonly cols: number;
  readonly rows: number;
}): React.ReactElement => {
  const bundle = Observe.use(props.tag, FleetHealthView.pack);
  const statusR = useAtomValue(bundle.status);
  const byNodeR = useAtomValue(bundle.byNode);
  const status = AsyncResult.isSuccess(statusR) ? statusR.value : undefined;
  const byNode = AsyncResult.isSuccess(byNodeR) ? byNodeR.value : {};
  const rows = Object.entries(byNode).sort(([a], [b]) => a.localeCompare(b));
  const border =
    status === "ok" ? "green" : status === "degraded" || status === "partial" ? "yellow" : "gray";
  return (
    <FocusChrome
      cols={props.cols}
      rows={props.rows}
      title={`${props.name} · ${status ?? "…"}`}
      borderColor={border}
    >
      {rows.map(([node, report]) => (
        <Text key={node}>
          {displayName(node)} — {fleetNodeLabel(report)}
        </Text>
      ))}
    </FocusChrome>
  );
};

export const TelemetryCell = (props: {
  readonly name: string;
  readonly tag: TelemetryTag;
  readonly width: number;
  readonly selected: boolean;
}): React.ReactElement => {
  const bundle = Observe.use(props.tag, TelemetryView.pack);
  const fleetR = useAtomValue(bundle.fleetInFlight);
  const byNodeR = useAtomValue(bundle.inFlightByNode);
  const countR = useAtomValue(bundle.metricCount);
  const fleet = AsyncResult.isSuccess(fleetR) ? fleetR.value : 0;
  const byNode = AsyncResult.isSuccess(byNodeR) ? byNodeR.value : {};
  const count = AsyncResult.isSuccess(countR) ? countR.value : undefined;
  const rows = Object.entries(byNode).sort(([a], [b]) => a.localeCompare(b));
  const max = Math.max(1, ...rows.map(([, n]) => n));
  const barWidth = Math.max(4, props.width - 16);
  return (
    <CellShell selected={props.selected} width={props.width} borderColor="cyan">
      <Box>
        <Box flexGrow={1}>
          <Text bold wrap="truncate">
            {props.name}
          </Text>
        </Box>
        {count !== undefined ? <Text dimColor>{count} m</Text> : null}
      </Box>
      <Text>
        fleet in-flight <Text bold>{fleet}</Text>
      </Text>
      <NodeRows rows={rows} max={max} barWidth={barWidth} />
    </CellShell>
  );
};

export const FocusedTelemetry = (props: {
  readonly name: string;
  readonly tag: TelemetryTag;
  readonly cols: number;
  readonly rows: number;
}): React.ReactElement => {
  const bundle = Observe.use(props.tag, TelemetryView.pack);
  const fleetR = useAtomValue(bundle.fleetInFlight);
  const byNodeR = useAtomValue(bundle.inFlightByNode);
  const countR = useAtomValue(bundle.metricCount);
  const metricsR = useAtomValue(bundle.metrics);
  const fleet = AsyncResult.isSuccess(fleetR) ? fleetR.value : 0;
  const byNode = AsyncResult.isSuccess(byNodeR) ? byNodeR.value : {};
  const count = AsyncResult.isSuccess(countR) ? countR.value : 0;
  const metrics = AsyncResult.isSuccess(metricsR) ? metricsR.value : [];
  const rows = Object.entries(byNode).sort(([a], [b]) => a.localeCompare(b));
  const max = Math.max(1, ...rows.map(([, n]) => n));
  return (
    <FocusChrome cols={props.cols} rows={props.rows} title={props.name} borderColor="cyan">
      <Text>
        fleet in-flight {fleet} · {count} metrics on this node
      </Text>
      <NodeRows rows={rows} max={max} barWidth={Math.max(8, props.cols - 28)} />
      <Box marginTop={1} flexDirection="column">
        {metrics.slice(0, Math.max(3, props.rows - 14)).map((m) => (
          <Text key={m.id} dimColor wrap="truncate">
            {m.id} · {m._tag}
          </Text>
        ))}
      </Box>
    </FocusChrome>
  );
};

export const ShardMapCell = (props: {
  readonly name: string;
  readonly tag: ShardMapTag;
  readonly width: number;
  readonly selected: boolean;
}): React.ReactElement => {
  const bundle = Observe.use(props.tag, ShardMapView.pack);
  const sizeR = useAtomValue(bundle.size);
  const byNodeR = useAtomValue(bundle.sizeByNode);
  const localR = useAtomValue(bundle.sizeLocal);
  const size = AsyncResult.isSuccess(sizeR) ? sizeR.value : 0;
  const byNode = AsyncResult.isSuccess(byNodeR) ? byNodeR.value : {};
  const local = AsyncResult.isSuccess(localR) ? localR.value : undefined;
  const rows = Object.entries(byNode).sort(([a], [b]) => a.localeCompare(b));
  const max = Math.max(1, ...rows.map(([, n]) => n));
  const barWidth = Math.max(4, props.width - 16);
  return (
    <CellShell selected={props.selected} width={props.width} borderColor="yellow">
      <Box>
        <Box flexGrow={1}>
          <Text bold wrap="truncate">
            {props.name}
          </Text>
        </Box>
        <Text dimColor>{rows.length} shards</Text>
      </Box>
      <Text>
        entries <Text bold>{compact(size)}</Text>
        {local !== undefined ? <Text dimColor> · local {compact(local)}</Text> : null}
      </Text>
      <NodeRows rows={rows} max={max} barWidth={barWidth} />
    </CellShell>
  );
};

export const FocusedShardMap = (props: {
  readonly name: string;
  readonly tag: ShardMapTag;
  readonly cols: number;
  readonly rows: number;
}): React.ReactElement => {
  const bundle = Observe.use(props.tag, ShardMapView.pack);
  const sizeR = useAtomValue(bundle.size);
  const byNodeR = useAtomValue(bundle.sizeByNode);
  const localR = useAtomValue(bundle.sizeLocal);
  const size = AsyncResult.isSuccess(sizeR) ? sizeR.value : 0;
  const byNode = AsyncResult.isSuccess(byNodeR) ? byNodeR.value : {};
  const local = AsyncResult.isSuccess(localR) ? localR.value : undefined;
  const rows = Object.entries(byNode).sort(([a], [b]) => a.localeCompare(b));
  const max = Math.max(1, ...rows.map(([, n]) => n));
  return (
    <FocusChrome cols={props.cols} rows={props.rows} title={props.name} borderColor="yellow">
      <Text>
        fleet entries {compact(size)}
        {local !== undefined ? ` · this node ${compact(local)}` : ""}
      </Text>
      <NodeRows rows={rows} max={max} barWidth={Math.max(8, props.cols - 28)} />
    </FocusChrome>
  );
};
