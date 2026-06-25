/**
 * @module web/widgets
 *
 * Module-aware widgets — one per toolkit resource type — giving each its natural
 * presentation (a queue's priority depths, a process's supervision state, a
 * schedule's entries) on top of the same generic binding. `ResourceView` picks the
 * right one from `ui.kind` and falls back to the generic widget for anything else.
 *
 * @since 1.0.0
 */
import * as React from "react";
import type { ResourceUI, ValueAtom } from "./binding";
import { Badge, Bar, Card, Field, SectionLabel, type Tone } from "./primitives";
import { renderValue, ValuePanel } from "./panels";
import { CommandBar, GenericResourceWidget, ResourceHeader } from "./ResourceWidget";

// defensive readers over the unknown stream value (the schema lives on the wire).
const rec = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
const num = (v: unknown): number => (typeof v === "number" ? v : 0);
const bool = (v: unknown): boolean => v === true;
const str = (v: unknown): string => (typeof v === "string" ? v : v === undefined ? "—" : String(v));

const phaseTone = (phase: string, paused: boolean): Tone =>
  paused ? "yellow" : phase === "running" ? "green" : phase === "draining" ? "blue" : "gray";

/** A queue: phase, per-priority depths, throughput, and its controls. @since 1.0.0 */
export const QueueWidget = (props: { readonly ui: ResourceUI; readonly host?: string }): React.ReactElement => {
  const status = props.ui.streams["status"];
  return (
    <Card>
      <ResourceHeader ui={props.ui} host={props.host} />
      {status !== undefined ? <ValuePanel atom={status} render={queueStatus} /> : null}
      <CommandBar ui={props.ui} />
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
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Badge tone={phaseTone(str(s["phase"]), bool(s["paused"]))}>
          {bool(s["paused"]) ? "paused" : str(s["phase"])}
        </Badge>
        <span className="text-xs text-neutral-500">completed {num(s["completed"])} · in-flight {num(s["inFlight"])}</span>
      </div>
      {lanes.map(([name, val, tone]) => (
        <div key={name} className="flex items-center gap-2">
          <span className="w-12 text-xs text-neutral-500">{name}</span>
          <div className="flex-1"><Bar value={val / total} tone={tone} /></div>
          <span className="w-8 text-right text-xs text-neutral-300">{val}</span>
        </div>
      ))}
    </div>
  );
};

/** A process: supervision/armed/active + next trigger, and its controls. @since 1.0.0 */
export const ProcessWidget = (props: { readonly ui: ResourceUI; readonly host?: string }): React.ReactElement => {
  const status = props.ui.streams["status"];
  return (
    <Card>
      <ResourceHeader ui={props.ui} host={props.host} />
      {status !== undefined ? <ValuePanel atom={status} render={processStatus} /> : null}
      <CommandBar ui={props.ui} />
    </Card>
  );
};

const processStatus = (v: unknown): React.ReactNode => {
  const s = rec(v);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <Badge tone={bool(s["supervising"]) ? "green" : "gray"}>{bool(s["supervising"]) ? "supervising" : "stopped"}</Badge>
        <Badge tone={bool(s["armed"]) ? "blue" : "gray"}>{bool(s["armed"]) ? "armed" : "disarmed"}</Badge>
      </div>
      <Field label="active instances">{num(s["activeInstances"])}</Field>
      <Field label="next trigger">{str(s["nextTriggerRun"])}</Field>
    </div>
  );
};

/** A schedule: its current entries (live) + controls. @since 1.0.0 */
export const ScheduleWidget = (props: { readonly ui: ResourceUI; readonly host?: string }): React.ReactElement => {
  const live: ValueAtom | undefined = props.ui.streams["changes"] ?? props.ui.reads["entries"];
  return (
    <Card>
      <ResourceHeader ui={props.ui} host={props.host} />
      <SectionLabel>entries</SectionLabel>
      {live !== undefined ? <ValuePanel atom={live} render={renderEntries} /> : null}
      <CommandBar ui={props.ui} />
    </Card>
  );
};

const renderEntries = (v: unknown): React.ReactNode => {
  if (!Array.isArray(v)) return <span className="text-xs text-neutral-600">no entries</span>;
  return (
    <div className="flex flex-col gap-0.5">
      {v.slice(0, 8).map((entry, i) => (
        <div key={i} className="font-mono text-xs text-neutral-400">{str(rec(entry)["id"]) || `entry ${i}`}</div>
      ))}
      {v.length > 8 ? <span className="text-xs text-neutral-600">+{v.length - 8} more</span> : null}
    </div>
  );
};

/** A run resource — generic view (one-shot runs surface as commands). @since 1.0.0 */
export const RunWidget = (props: { readonly ui: ResourceUI; readonly host?: string }): React.ReactElement => (
  <GenericResourceWidget ui={props.ui} host={props.host} />
);

/** A group branch card (header + member count) used by the tree view. @since 1.0.0 */
export const GroupCard = (props: {
  readonly name: string;
  readonly count: number;
  readonly onOpen?: () => void;
  readonly children?: React.ReactNode;
}): React.ReactElement => (
  <Card>
    <button type="button" onClick={props.onOpen} className="flex w-full items-center justify-between">
      <strong className="text-sm text-neutral-100">{props.name}</strong>
      <Badge tone="blue">{props.count} members</Badge>
    </button>
    {props.children !== undefined ? <div className="mt-2">{props.children}</div> : null}
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

// keep renderValue reachable for consumers building custom panels.
export { renderValue };
