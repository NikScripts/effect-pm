/**
 * @module examples/apps/queue-widget/QueueWidget
 *
 * Interactive presentation of (almost) the whole `WorkPool` surface: every
 * read (`size` / `sizes` / `completed` / `isEmpty`), every lifecycle control
 * (`start` / `pause` / `resume` / `clear` / `stop` / `release`), and enqueue
 * by priority (`add` / `prioritize` / `defer`). It knows nothing about atoms —
 * the demo wires these callbacks.
 *
 * Not yet shown: a live `status` Subscribable read (the badge here is tracked
 * client-side from the controls). `deadLetter` / `drop` are wired via a
 * target-by-text selector.
 */

import * as React from "react";
import type { QueueStats } from "./queue-atoms";

export type QueuePriority = "normal" | "high" | "low";
export type QueueStatus = "paused" | "running" | "off";

export interface QueueWidgetProps {
  readonly title?: string;
  readonly stats: QueueStats | undefined;
  readonly status: QueueStatus;
  readonly lastResult?: string;
  readonly onEnqueue: (text: string, priority: QueuePriority) => void;
  readonly onStart: () => void;
  readonly onResume: () => void;
  readonly onPause: () => void;
  readonly onClear: () => void;
  readonly onRelease: () => void;
  readonly onStop: () => void;
  readonly onRefresh: () => void;
  readonly onDrop: (item: string) => void;
  readonly onDeadLetter: (item: string) => void;
}

export const QueueWidget = (props: QueueWidgetProps): React.ReactElement => {
  const { title, stats, status, lastResult } = props;
  const [text, setText] = React.useState("");
  const [priority, setPriority] = React.useState<QueuePriority>("normal");
  const [target, setTarget] = React.useState("");

  const submit = (): void => {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      return;
    }
    props.onEnqueue(trimmed, priority);
    setText("");
  };

  const down = status === "off";

  return (
    <section style={styles.card}>
      <header style={styles.head}>
        <span>{title ?? "Queue"}</span>
        <span style={{ ...styles.badge, ...statusStyle[status] }}>{status}</span>
      </header>

      <dl style={styles.stats}>
        <Stat label="pending" value={stats?.size} />
        <Stat label="high" value={stats?.sizes.high} />
        <Stat label="normal" value={stats?.sizes.normal} />
        <Stat label="low" value={stats?.sizes.low} />
        <Stat label="completed" value={stats?.completed} />
        <Stat
          label="empty"
          value={stats === undefined ? undefined : stats.isEmpty ? "yes" : "no"}
        />
      </dl>

      <div style={styles.enqueue}>
        <input
          style={styles.input}
          value={text}
          placeholder="item text…"
          disabled={down}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              submit();
            }
          }}
        />
        <select
          style={styles.select}
          value={priority}
          disabled={down}
          onChange={(event) =>
            setPriority(event.target.value as QueuePriority)
          }
        >
          <option value="high">high</option>
          <option value="normal">normal</option>
          <option value="low">low</option>
        </select>
        <button type="button" disabled={down} onClick={submit}>
          Add
        </button>
      </div>

      <div style={styles.row}>
        <button type="button" title="fork the worker pool" onClick={props.onStart}>
          Start
        </button>
        <button type="button" title="unpause" onClick={props.onResume}>
          Resume
        </button>
        <button type="button" title="pause processing" onClick={props.onPause}>
          Pause
        </button>
        <button type="button" title="drain pending, keep workers" onClick={props.onClear}>
          Clear
        </button>
        <button type="button" title="export + remove pending" onClick={props.onRelease}>
          Release
        </button>
        <button
          type="button"
          title="permanent stop"
          style={styles.danger}
          onClick={props.onStop}
        >
          Stop
        </button>
        <button type="button" title="refresh now" onClick={props.onRefresh}>
          ↻
        </button>
      </div>

      <div style={styles.enqueue}>
        <input
          style={styles.input}
          value={target}
          placeholder="item to route (by text)"
          disabled={down}
          onChange={(event) => setTarget(event.target.value)}
        />
        <button
          type="button"
          disabled={down || target.trim().length === 0}
          title="remove matching pending entries"
          onClick={() => props.onDrop(target.trim())}
        >
          Drop
        </button>
        <button
          type="button"
          disabled={down || target.trim().length === 0}
          title="route matching pending entries to dead-letter"
          onClick={() => props.onDeadLetter(target.trim())}
        >
          Dead-letter
        </button>
      </div>

      <p style={styles.result}>{lastResult ?? " "}</p>
    </section>
  );
};

const Stat = (props: {
  readonly label: string;
  readonly value: React.ReactNode;
}): React.ReactElement => (
  <div style={styles.stat}>
    <dt style={styles.statLabel}>{props.label}</dt>
    <dd style={styles.statValue}>{props.value ?? "—"}</dd>
  </div>
);

const statusStyle: Record<QueueStatus, React.CSSProperties> = {
  running: { background: "#e6f4ea", color: "#137333" },
  paused: { background: "#fef7e0", color: "#b06000" },
  off: { background: "#fce8e6", color: "#c5221f" },
};

const styles = {
  card: {
    border: "1px solid #ddd",
    borderRadius: 8,
    padding: 16,
    width: 420,
    fontFamily: "system-ui, sans-serif",
  },
  head: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontWeight: 600,
    marginBottom: 12,
  },
  badge: {
    fontSize: 11,
    fontWeight: 600,
    padding: "2px 8px",
    borderRadius: 999,
    textTransform: "uppercase",
  },
  stats: {
    display: "grid",
    gridTemplateColumns: "repeat(6, 1fr)",
    gap: 8,
    margin: "0 0 16px",
  },
  stat: { textAlign: "center" },
  statLabel: { fontSize: 11, color: "#666" },
  statValue: { fontSize: 18, fontWeight: 600, margin: 0 },
  enqueue: { display: "flex", gap: 8, marginBottom: 12 },
  input: { flex: 1, padding: "6px 8px" },
  select: { padding: "6px 8px" },
  row: { display: "flex", gap: 8, flexWrap: "wrap" },
  danger: { color: "#c5221f" },
  result: { fontSize: 12, color: "#444", margin: "12px 0 0", minHeight: 16 },
} satisfies Record<string, React.CSSProperties>;
