/**
 * @module web/chart
 *
 * Live panels over a stream's accumulated history (`ui.histories[...]`): a Recharts
 * area chart for a numeric metric field, and an auto-scrolling log pane. Recharts is
 * a peer dependency.
 *
 * @since 1.0.0
 */
import * as React from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { AsyncResult } from "effect/unstable/reactivity";
import type { ValueAtom } from "./binding";
import { useAtomValue } from "./atom-react";

const useHistory = (atom: ValueAtom): ReadonlyArray<unknown> => {
  const r = useAtomValue(atom);
  return AsyncResult.isSuccess(r) && Array.isArray(r.value) ? r.value : [];
};

const numField = (v: unknown, field: string): number => {
  if (typeof v === "object" && v !== null) {
    const val = (v as Record<string, unknown>)[field];
    return typeof val === "number" ? val : 0;
  }
  return 0;
};

const strField = (v: unknown, field: string): string => {
  if (typeof v === "object" && v !== null) {
    const val = (v as Record<string, unknown>)[field];
    return typeof val === "string" ? val : "";
  }
  return "";
};

/** An area chart of one numeric field across a stream's recent history. @since 1.0.0 */
export const MetricChart = (props: {
  readonly atom: ValueAtom;
  readonly field: string;
  readonly color?: string;
  readonly height?: number;
}): React.ReactElement => {
  const history = useHistory(props.atom);
  const color = props.color ?? "#34d399";
  const data = history.map((v, i) => ({ i, value: numField(v, props.field) }));
  return (
    <ResponsiveContainer width="100%" height={props.height ?? 120}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id={`g-${props.field}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.4} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <YAxis hide domain={[0, "auto"]} />
        <Tooltip
          contentStyle={{ background: "oklch(0.2 0.012 260)", border: "1px solid oklch(0.3 0.01 260)", borderRadius: 8, fontSize: 12 }}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          fill={`url(#g-${props.field})`}
          strokeWidth={2}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
};

const levelColor = (level: string): string =>
  /error|fatal/i.test(level) ? "text-rose-400" : /warn/i.test(level) ? "text-amber-400" : "text-muted-foreground";

/** An auto-scrolling log pane over a `logs` stream's history. @since 1.0.0 */
export const LogStream = (props: {
  readonly atom: ValueAtom;
  readonly className?: string;
}): React.ReactElement => {
  const history = useHistory(props.atom);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (ref.current !== null) ref.current.scrollTop = ref.current.scrollHeight;
  }, [history.length]);
  return (
    <div ref={ref} className={props.className ?? "max-h-48 overflow-auto rounded-md border bg-background p-2"}>
      {history.length === 0 ? (
        <div className="text-xs text-muted-foreground">no logs</div>
      ) : (
        history.map((line, i) => (
          <div key={i} className={`font-mono text-xs ${levelColor(strField(line, "level"))}`}>
            {strField(line, "message") || JSON.stringify(line)}
          </div>
        ))
      )}
    </div>
  );
};
