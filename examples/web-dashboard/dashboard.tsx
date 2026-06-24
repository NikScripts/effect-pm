/**
 * @module examples/web-dashboard/dashboard
 *
 * The queue dashboard in the **browser** — the same `live-queues` atoms as the Ink
 * dashboard, rendered as DOM. Tap a card to open a queue: live status + metrics +
 * the real logs stream, with controls. Mobile-first (built to view over Tailscale).
 */

import * as React from "react";
import { AsyncResult } from "effect/unstable/reactivity";
import {
  REGISTRY,
  TREE,
  type Group,
  type LogLine,
  type QueueBundle,
} from "../resource-tui/live-queues";
import { useAtomSet, useAtomValue } from "../queue-widget/atom-react";

// inlined (not imported from queue-widget, which pulls in Ink → not browser-safe)
const displayName = (key: string): string => key.split("/").pop() ?? key;

type Phase = "running" | "draining" | "off";
const STATUS = {
  running: { label: "running", color: "#22c55e" },
  paused: { label: "paused", color: "#eab308" },
  draining: { label: "draining", color: "#06b6d4" },
  off: { label: "off", color: "#ef4444" },
};
const PRIO = {
  high: { label: "high", color: "#ef4444" },
  normal: { label: "normal", color: "#94a3b8" },
  low: { label: "low", color: "#3b82f6" },
} as const;
const LEVEL: Record<string, string> = {
  Trace: "#64748b",
  Debug: "#64748b",
  Info: "#cbd5e1",
  Warning: "#eab308",
  Error: "#ef4444",
  Fatal: "#ef4444",
};

const statusKey = (phase: Phase, paused: boolean): keyof typeof STATUS =>
  phase === "off" ? "off" : phase === "draining" ? "draining" : paused ? "paused" : "running";
const fmtMs = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;
const timeStr = (t: number): string => new Date(t).toLocaleTimeString();

const Pill = (props: { readonly skey: keyof typeof STATUS }): React.ReactElement => {
  const s = STATUS[props.skey];
  return (
    <span
      style={{
        color: s.color,
        border: `1px solid ${s.color}`,
        borderRadius: 999,
        padding: "1px 8px",
        fontSize: 12,
      }}
    >
      {s.label}
    </span>
  );
};

const Bar = (props: {
  readonly value: number;
  readonly max: number;
  readonly color: string;
}): React.ReactElement => (
  <div style={{ flex: 1, height: 6, background: "#1e2636", borderRadius: 3, overflow: "hidden" }}>
    <div
      style={{
        width: `${props.max <= 0 ? 0 : Math.min(100, (props.value / props.max) * 100)}%`,
        height: "100%",
        background: props.color,
      }}
    />
  </div>
);

const PrioRow = (props: {
  readonly p: keyof typeof PRIO;
  readonly count: number;
  readonly max: number;
}): React.ReactElement => (
  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
    <span style={{ width: 52, color: PRIO[props.p].color }}>{PRIO[props.p].label}</span>
    <Bar value={props.count} max={props.max} color={PRIO[props.p].color} />
    <span style={{ width: 32, textAlign: "right" }}>{props.count}</span>
  </div>
);

const card: React.CSSProperties = {
  background: "#141925",
  border: "1px solid #1e2636",
  borderRadius: 12,
  padding: 14,
};

const QueueCard = (props: {
  readonly id: string;
  readonly bundle: QueueBundle;
  readonly onOpen: (id: string) => void;
}): React.ReactElement => {
  const r = useAtomValue(props.bundle.status);
  const s = AsyncResult.isSuccess(r) ? r.value : undefined;
  const sizes = s?.sizes ?? { high: 0, normal: 0, low: 0 };
  const pending = sizes.high + sizes.normal + sizes.low;
  const max = Math.max(sizes.high, sizes.normal, sizes.low, 1);
  const sk = statusKey((s?.phase ?? "running") as Phase, s?.paused ?? false);
  return (
    <button
      type="button"
      onClick={() => props.onOpen(props.id)}
      style={{
        ...card,
        textAlign: "left",
        color: "inherit",
        font: "inherit",
        cursor: "pointer",
        borderColor: STATUS[sk].color + "55",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <strong style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {displayName(props.id)}
        </strong>
        <Pill skey={sk} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", color: "#94a3b8", marginBottom: 8 }}>
        <span>
          pending <strong style={{ color: "#e2e8f0" }}>{pending}</strong>
        </span>
        <span>{s?.completed ?? 0} done</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <PrioRow p="high" count={sizes.high} max={max} />
        <PrioRow p="normal" count={sizes.normal} max={max} />
        <PrioRow p="low" count={sizes.low} max={max} />
      </div>
    </button>
  );
};

const Spark = (props: { readonly values: ReadonlyArray<number> }): React.ReactElement => {
  const max = Math.max(...props.values, 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 1, height: 28 }}>
      {props.values.map((v, i) => (
        <div
          key={i}
          style={{
            width: 4,
            height: `${Math.max(2, (v / max) * 28)}px`,
            background: "#22c55e",
            borderRadius: 1,
          }}
        />
      ))}
    </div>
  );
};

const ctrlBtn: React.CSSProperties = {
  background: "#1e2636",
  color: "#cbd5e1",
  border: "1px solid #2b3650",
  borderRadius: 8,
  padding: "8px 14px",
  font: "inherit",
  cursor: "pointer",
};

const FocusedPanel = (props: {
  readonly id: string;
  readonly bundle: QueueBundle;
  readonly onBack: () => void;
}): React.ReactElement => {
  const { id, bundle } = props;
  const statusR = useAtomValue(bundle.status);
  const metricsR = useAtomValue(bundle.metrics);
  const logsR = useAtomValue(bundle.logs);
  const trendR = useAtomValue(bundle.trend);
  const pause = useAtomSet(bundle.pause);
  const resume = useAtomSet(bundle.resume);
  const clear = useAtomSet(bundle.clear);
  const shutdown = useAtomSet(bundle.shutdown);

  const s = AsyncResult.isSuccess(statusR) ? statusR.value : undefined;
  const m = AsyncResult.isSuccess(metricsR) ? metricsR.value : undefined;
  const logs = AsyncResult.isSuccess(logsR) ? logsR.value : [];
  const trend = AsyncResult.isSuccess(trendR) ? trendR.value : [];
  const sizes = s?.sizes ?? { high: 0, normal: 0, low: 0 };
  const max = Math.max(sizes.high, sizes.normal, sizes.low, 1);
  const sk = statusKey((s?.phase ?? "running") as Phase, s?.paused ?? false);

  const logRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = logRef.current;
    if (el !== null) {
      el.scrollTop = el.scrollHeight;
    }
  }, [logs.length]);

  const stat = (label: string, value: string) => (
    <div style={{ ...card, flex: "1 1 120px" }}>
      <div style={{ color: "#64748b", fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 18, color: "#e2e8f0" }}>{value}</div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: 14, gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button type="button" onClick={props.onBack} style={ctrlBtn}>
          ← back
        </button>
        <strong style={{ flex: 1, fontSize: 16 }}>{displayName(id)}</strong>
        <Pill skey={sk} />
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {stat("pending", String(sizes.high + sizes.normal + sizes.low))}
        {stat("completed", String(s?.completed ?? 0))}
        {stat("in-flight", String(s?.inFlight ?? 0))}
        {stat("throughput", `${(m?.throughputPerSec ?? 0).toFixed(1)}/s`)}
      </div>

      <div style={{ ...card, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 52, color: PRIO.high.color }}>high</span>
          <Bar value={sizes.high} max={max} color={PRIO.high.color} />
          <span style={{ width: 32, textAlign: "right" }}>{sizes.high}</span>
          <span style={{ width: 64, textAlign: "right", color: "#64748b" }}>
            {fmtMs(m?.avgWaitMillis.high ?? 0)}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 52, color: PRIO.normal.color }}>normal</span>
          <Bar value={sizes.normal} max={max} color={PRIO.normal.color} />
          <span style={{ width: 32, textAlign: "right" }}>{sizes.normal}</span>
          <span style={{ width: 64, textAlign: "right", color: "#64748b" }}>
            {fmtMs(m?.avgWaitMillis.normal ?? 0)}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 52, color: PRIO.low.color }}>low</span>
          <Bar value={sizes.low} max={max} color={PRIO.low.color} />
          <span style={{ width: 32, textAlign: "right" }}>{sizes.low}</span>
          <span style={{ width: 64, textAlign: "right", color: "#64748b" }}>
            {fmtMs(m?.avgWaitMillis.low ?? 0)}
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", color: "#94a3b8", fontSize: 13 }}>
          <span>exec ⌀ {fmtMs(m?.avgExecutionMillis ?? 0)}</span>
          <span>total ⌀ {fmtMs(m?.avgTotalMillis ?? 0)}</span>
        </div>
        <Spark values={trend} />
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" onClick={() => pause()} style={ctrlBtn}>
          pause
        </button>
        <button type="button" onClick={() => resume()} style={ctrlBtn}>
          resume
        </button>
        <button type="button" onClick={() => clear()} style={ctrlBtn}>
          clear
        </button>
        <button type="button" onClick={() => shutdown()} style={{ ...ctrlBtn, borderColor: "#ef444455", color: "#ef4444" }}>
          shutdown
        </button>
      </div>

      <div style={{ color: "#64748b", fontSize: 12 }}>
        LOGS <span style={{ color: "#22c55e" }}>live</span> · phase {s?.phase ?? "?"}
      </div>
      <div
        ref={logRef}
        style={{ ...card, flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: 2 }}
      >
        {logs.map((l: LogLine) => (
          <div key={l.id} style={{ display: "flex", gap: 8 }}>
            <span style={{ color: "#475569", width: 90, flexShrink: 0 }}>{timeStr(l.t)}</span>
            <span style={{ color: LEVEL[l.level] ?? "#cbd5e1", width: 56, flexShrink: 0 }}>{l.level}</span>
            <span style={{ wordBreak: "break-word" }}>{l.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const QueueGrid = (props: {
  readonly ids: ReadonlyArray<string>;
  readonly onOpen: (id: string) => void;
}): React.ReactElement | null =>
  props.ids.length === 0 ? null : (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
        gap: 10,
      }}
    >
      {props.ids.map((id) => {
        const b = REGISTRY[id];
        return b === undefined ? null : (
          <QueueCard key={id} id={id} bundle={b} onOpen={props.onOpen} />
        );
      })}
    </div>
  );

// total leaf queues under a group (recursive)
const leafCount = (node: Group): number =>
  node.members.reduce((n, m) => n + (m.t === "g" ? leafCount(m) : 1), 0);

// a group and, recursively, its subgroups — nested + indented to show hierarchy
const GroupView = (props: {
  readonly node: Group;
  readonly depth: number;
  readonly onOpen: (id: string) => void;
}): React.ReactElement => {
  const { node, depth } = props;
  const queues = node.members.filter((n) => n.t === "q").map((n) => n.name);
  const subgroups = node.members.filter((n): n is Group => n.t === "g");
  const nested = depth > 0;
  return (
    <div
      style={
        nested
          ? { borderLeft: "2px solid #1e2636", paddingLeft: 12, marginLeft: 4, marginTop: 10 }
          : { marginTop: 10 }
      }
    >
      {nested ? (
        <div style={{ color: "#06b6d4", margin: "4px 0 8px", fontSize: 13 }}>
          ▸ {displayName(node.name)} <span style={{ color: "#64748b" }}>· {leafCount(node)}</span>
        </div>
      ) : null}
      <QueueGrid ids={queues} onOpen={props.onOpen} />
      {subgroups.map((sg) => (
        <GroupView key={sg.name} node={sg} depth={depth + 1} onOpen={props.onOpen} />
      ))}
    </div>
  );
};

export const App = (): React.ReactElement => {
  const [focused, setFocused] = React.useState<string | null>(null);

  if (focused !== null) {
    const b = REGISTRY[focused];
    if (b !== undefined) {
      return <FocusedPanel key={focused} id={focused} bundle={b} onBack={() => setFocused(null)} />;
    }
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 14 }}>
      <h1 style={{ fontSize: 18, margin: "4px 0 2px" }}>
        ⬢ {displayName(TREE.name)} <span style={{ color: "#64748b", fontSize: 13 }}>· {leafCount(TREE)} queues</span>
      </h1>
      <div style={{ color: "#64748b", fontSize: 13 }}>tap a queue for live metrics + logs</div>
      <GroupView node={TREE} depth={0} onOpen={setFocused} />
    </div>
  );
};
