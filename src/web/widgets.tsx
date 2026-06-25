/**
 * @module web/widgets
 *
 * Module-aware widgets — one per toolkit resource type — on the dashboard theme:
 * a queue's phase + priority depths + throughput chart + log pane + controls; a
 * process's supervision state + controls; a schedule's entries. All driven by the
 * generic binding (`ui.streams` / `ui.histories` / `ui.commands`). `ResourceView`
 * dispatches by `ui.kind`, falling back to the generic widget.
 *
 * @since 1.0.0
 */
import * as React from "react";
import type { ResourceUI } from "./binding";
import { Badge, Bar, Card, CardBody, SectionLabel, type Tone } from "./primitives";
import { renderValue, ValuePanel } from "./panels";
import { MetricChart, LogStream } from "./chart";
import { CommandBar, GenericResourceWidget, ResourceHeader } from "./ResourceWidget";

// defensive readers over the unknown stream value (the schema lives on the wire).
const rec = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
const num = (v: unknown): number => (typeof v === "number" ? v : 0);
const bool = (v: unknown): boolean => v === true;
const str = (v: unknown): string => (typeof v === "string" ? v : v === undefined ? "—" : String(v));

const phaseTone = (phase: string, paused: boolean): Tone =>
  paused ? "yellow" : phase === "running" ? "green" : phase === "draining" ? "blue" : "gray";

const Stat = (props: { readonly label: string; readonly value: React.ReactNode }): React.ReactElement => (
  <div className="rounded-lg border bg-background px-2 py-1">
    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{props.label}</div>
    <div className="text-sm font-semibold tabular-nums">{props.value}</div>
  </div>
);

// the primary controls to surface per module (the rest stay in the contract).
const controlsFor = (ui: ResourceUI): ReadonlyArray<string> => {
  switch (ui.kind) {
    case "queue":
      return ["add", "pause", "resume", "clear"];
    case "process":
      return ["start", "stop", "runImmediately"];
    case "schedule":
      return ["reconcile", "addSchedule", "clearSchedule"];
    default:
      return Object.keys(ui.commands);
  }
};

/** A queue: phase, per-priority depths, throughput chart, controls, logs. @since 1.0.0 */
export const QueueWidget = (props: { readonly ui: ResourceUI; readonly host?: string }): React.ReactElement => {
  const { ui } = props;
  return (
    <Card>
      <CardBody className="flex flex-col gap-2.5">
        <ResourceHeader ui={ui} host={props.host} />
        {ui.streams["status"] !== undefined ? <ValuePanel atom={ui.streams["status"]} render={queueStatus} /> : null}
        {ui.histories["metrics"] !== undefined ? (
          <div>
            <SectionLabel>throughput / sec</SectionLabel>
            <MetricChart atom={ui.histories["metrics"]} field="throughputPerSec" />
          </div>
        ) : null}
        <CommandBar ui={ui} only={controlsFor(ui)} />
        {ui.histories["logs"] !== undefined ? <LogStream atom={ui.histories["logs"]} /> : null}
      </CardBody>
    </Card>
  );
};

const queueStatus = (v: unknown): React.ReactNode => {
  const s = rec(v);
  const sizes = rec(s["sizes"]);
  const high = num(sizes["high"]);
  const normal = num(sizes["normal"]);
  const low = num(sizes["low"]);
  const total = high + normal + low || 1;
  const lanes: ReadonlyArray<readonly [string, number, Tone]> = [
    ["high", high, "red"],
    ["normal", normal, "blue"],
    ["low", low, "gray"],
  ];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Badge tone={phaseTone(str(s["phase"]), bool(s["paused"]))}>
          {bool(s["paused"]) ? "paused" : str(s["phase"])}
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="completed" value={num(s["completed"])} />
        <Stat label="in-flight" value={num(s["inFlight"])} />
      </div>
      <div className="flex flex-col gap-1.5">
        {lanes.map(([name, val, tone]) => (
          <div key={name} className="flex items-center gap-2">
            <span className="w-12 text-xs text-muted-foreground">{name}</span>
            <div className="flex-1"><Bar value={val / total} tone={tone} /></div>
            <span className="w-8 text-right text-xs tabular-nums">{val}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

/** A process: supervision/armed/active + next trigger, controls, logs. @since 1.0.0 */
export const ProcessWidget = (props: { readonly ui: ResourceUI; readonly host?: string }): React.ReactElement => {
  const { ui } = props;
  return (
    <Card>
      <CardBody className="flex flex-col gap-2.5">
        <ResourceHeader ui={ui} host={props.host} />
        {ui.streams["status"] !== undefined ? <ValuePanel atom={ui.streams["status"]} render={processStatus} /> : null}
        <CommandBar ui={ui} only={controlsFor(ui)} />
        {ui.histories["logs"] !== undefined ? <LogStream atom={ui.histories["logs"]} /> : null}
      </CardBody>
    </Card>
  );
};

const processStatus = (v: unknown): React.ReactNode => {
  const s = rec(v);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <Badge tone={bool(s["supervising"]) ? "green" : "gray"}>{bool(s["supervising"]) ? "supervising" : "stopped"}</Badge>
        <Badge tone={bool(s["armed"]) ? "blue" : "gray"}>{bool(s["armed"]) ? "armed" : "disarmed"}</Badge>
      </div>
      <Stat label="active instances" value={num(s["activeInstances"])} />
    </div>
  );
};

/** A schedule: its current entries (live) + controls. @since 1.0.0 */
export const ScheduleWidget = (props: { readonly ui: ResourceUI; readonly host?: string }): React.ReactElement => {
  const { ui } = props;
  const live = ui.streams["changes"] ?? ui.reads["entries"];
  return (
    <Card>
      <CardBody className="flex flex-col gap-2">
        <ResourceHeader ui={ui} host={props.host} />
        <SectionLabel>entries</SectionLabel>
        {live !== undefined ? <ValuePanel atom={live} render={renderEntries} /> : null}
        <CommandBar ui={ui} only={controlsFor(ui)} />
      </CardBody>
    </Card>
  );
};

const renderEntries = (v: unknown): React.ReactNode => {
  if (!Array.isArray(v) || v.length === 0) return <span className="text-xs text-muted-foreground">no entries</span>;
  return (
    <div className="flex flex-col gap-1">
      {v.slice(0, 8).map((entry, i) => (
        <div key={i} className="rounded border bg-background px-2 py-1 font-mono text-xs text-muted-foreground">
          {str(rec(entry)["id"]) || `entry ${i}`}
        </div>
      ))}
      {v.length > 8 ? <span className="text-xs text-muted-foreground">+{v.length - 8} more</span> : null}
    </div>
  );
};

/** A run resource — generic view (one-shot runs surface as commands). @since 1.0.0 */
export const RunWidget = (props: { readonly ui: ResourceUI; readonly host?: string }): React.ReactElement => (
  <GenericResourceWidget ui={props.ui} host={props.host} />
);

/** A group branch card (header + member count) for the tree view. @since 1.0.0 */
export const GroupCard = (props: {
  readonly name: string;
  readonly count: number;
  readonly onOpen?: () => void;
}): React.ReactElement => (
  <Card>
    <button type="button" onClick={props.onOpen} className="flex w-full items-center justify-between p-3 text-left transition-colors hover:bg-accent">
      <div className="flex items-center gap-2">
        <span className="text-base">📁</span>
        <strong className="text-sm">{props.name}</strong>
      </div>
      <Badge tone="blue">{props.count}</Badge>
    </button>
  </Card>
);

/** Dispatch to the module-aware widget for a resource, else the generic one. @since 1.0.0 */
export const ResourceView = (props: { readonly ui: ResourceUI; readonly host?: string }): React.ReactElement => {
  switch (props.ui.kind) {
    case "queue":
      return <QueueWidget ui={props.ui} host={props.host} />;
    case "process":
      return <ProcessWidget ui={props.ui} host={props.host} />;
    case "schedule":
      return <ScheduleWidget ui={props.ui} host={props.host} />;
    case "run":
      return <RunWidget ui={props.ui} host={props.host} />;
    default:
      return <GenericResourceWidget ui={props.ui} host={props.host} />;
  }
};

export { renderValue };
