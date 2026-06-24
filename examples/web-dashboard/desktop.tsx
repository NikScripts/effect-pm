/**
 * @module examples/web-dashboard/desktop
 *
 * The wide-screen dashboard: shadcn primitives + a TanStack Table fleet view +
 * Recharts metric graphs. Sidebar = the group tree (drill by clicking a group);
 * center = a sortable live table of the current group's queues; right = the selected
 * queue's detail (stat cards, a throughput chart, the live log stream). Same
 * `live-queues` data as the mobile view + the Ink TUI.
 */

import * as React from "react";
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AsyncResult } from "effect/unstable/reactivity";
import {
  REGISTRY,
  TREE,
  fleetAtom,
  type FleetRow,
  type Group,
  type LogLine,
  type Node,
  type QueueBundle,
} from "../resource-tui/live-queues";
import { useAtomValue } from "../queue-widget/atom-react";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./components/ui/table";
import { cn } from "./lib/utils";

const displayName = (key: string): string => key.split("/").pop() ?? key;
const STATUS: Record<string, { label: string; color: string }> = {
  running: { label: "running", color: "#22c55e" },
  paused: { label: "paused", color: "#eab308" },
  draining: { label: "draining", color: "#06b6d4" },
  off: { label: "off", color: "#ef4444" },
};
const statusKey = (phase: string, paused: boolean): string =>
  phase === "off" ? "off" : phase === "draining" ? "draining" : paused ? "paused" : "running";
const fmtMs = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

const leafIds = (g: Group): ReadonlyArray<string> =>
  g.members.flatMap((m) => (m.t === "g" ? leafIds(m) : [m.name]));

// ── sidebar tree ──
const TreeNode = (props: {
  readonly node: Node;
  readonly depth: number;
  readonly activeGroup: string;
  readonly onGroup: (g: Group) => void;
  readonly onQueue: (id: string) => void;
}): React.ReactElement => {
  const { node, depth } = props;
  if (node.t === "g") {
    return (
      <div>
        <button
          type="button"
          onClick={() => props.onGroup(node)}
          className={cn(
            "flex w-full items-center gap-1 rounded-md px-2 py-1 text-left text-sm hover:bg-accent",
            props.activeGroup === node.name && "bg-accent text-accent-foreground",
          )}
          style={{ paddingLeft: 8 + depth * 12 }}
        >
          <span className="text-[#06b6d4]">▸</span>
          <span className="truncate">{displayName(node.name)}</span>
        </button>
        {node.members
          .filter((m): m is Group => m.t === "g")
          .map((sg) => (
            <TreeNode key={sg.name} {...props} node={sg} depth={depth + 1} />
          ))}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => props.onQueue(node.name)}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
      style={{ paddingLeft: 16 + depth * 12 }}
    >
      <span className="truncate">{displayName(node.name)}</span>
    </button>
  );
};

// ── fleet table ──
const StatusBadge = ({ row }: { row: FleetRow }): React.ReactElement => {
  const s = STATUS[statusKey(row.phase, row.paused)] ?? STATUS.running!;
  return <Badge color={s.color}>{s.label}</Badge>;
};

const columns: ReadonlyArray<ColumnDef<FleetRow>> = [
  {
    accessorKey: "id",
    header: "queue",
    cell: (c) => <span className="font-medium text-foreground">{displayName(c.row.original.id)}</span>,
  },
  { id: "status", header: "status", accessorFn: (r) => r.phase, cell: (c) => <StatusBadge row={c.row.original} /> },
  { accessorKey: "pending", header: "pending" },
  { accessorKey: "inFlight", header: "in-flight" },
  { accessorKey: "completed", header: "done" },
  {
    accessorKey: "throughput",
    header: "thr/s",
    cell: (c) => c.row.original.throughput.toFixed(1),
  },
  {
    accessorKey: "latency",
    header: "latency",
    cell: (c) => fmtMs(c.row.original.latency),
  },
];

const FleetTable = (props: {
  readonly group: Group;
  readonly selected: string | null;
  readonly onSelect: (id: string) => void;
}): React.ReactElement => {
  const fleetR = useAtomValue(fleetAtom);
  const fleet = AsyncResult.isSuccess(fleetR) ? fleetR.value : {};
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const ids = leafIds(props.group);
  const data = React.useMemo(
    () =>
      ids.map(
        (id): FleetRow =>
          fleet[id] ?? {
            id,
            phase: "running",
            paused: false,
            pending: 0,
            completed: 0,
            inFlight: 0,
            throughput: 0,
            latency: 0,
          },
      ),
    [fleet, ids],
  );
  const table = useReactTable({
    data: data as Array<FleetRow>,
    columns: columns as Array<ColumnDef<FleetRow>>,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  return (
    <Table>
      <TableHeader>
        {table.getHeaderGroups().map((hg) => (
          <TableRow key={hg.id}>
            {hg.headers.map((h) => (
              <TableHead
                key={h.id}
                onClick={h.column.getToggleSortingHandler()}
                className="cursor-pointer select-none"
              >
                {flexRender(h.column.columnDef.header, h.getContext())}
                {h.column.getIsSorted() === "asc" ? " ↑" : h.column.getIsSorted() === "desc" ? " ↓" : ""}
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((r) => (
          <TableRow
            key={r.original.id}
            data-selected={r.original.id === props.selected}
            onClick={() => props.onSelect(r.original.id)}
            className="cursor-pointer"
          >
            {r.getVisibleCells().map((cell) => (
              <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

// ── detail panel ──
const LEVEL: Record<string, string> = {
  Info: "#cbd5e1",
  Warning: "#eab308",
  Error: "#ef4444",
  Fatal: "#ef4444",
};
const Stat = (props: { readonly label: string; readonly value: string }): React.ReactElement => (
  <Card className="flex-1">
    <CardContent className="p-3">
      <div className="text-xs text-muted-foreground">{props.label}</div>
      <div className="text-lg text-foreground">{props.value}</div>
    </CardContent>
  </Card>
);

const Detail = (props: { readonly id: string; readonly bundle: QueueBundle }): React.ReactElement => {
  const statusR = useAtomValue(props.bundle.status);
  const metricsR = useAtomValue(props.bundle.metrics);
  const historyR = useAtomValue(props.bundle.history);
  const logsR = useAtomValue(props.bundle.logs);
  const s = AsyncResult.isSuccess(statusR) ? statusR.value : undefined;
  const m = AsyncResult.isSuccess(metricsR) ? metricsR.value : undefined;
  const history = AsyncResult.isSuccess(historyR) ? historyR.value : [];
  const logs = AsyncResult.isSuccess(logsR) ? logsR.value : [];
  const sizes = s?.sizes ?? { high: 0, normal: 0, low: 0 };
  const sk = statusKey(s?.phase ?? "running", s?.paused ?? false);

  const logRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = logRef.current;
    if (el !== null) {
      el.scrollTop = el.scrollHeight;
    }
  }, [logs.length]);

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-3">
      <div className="flex items-center gap-2">
        <span className="flex-1 truncate text-base font-semibold">{displayName(props.id)}</span>
        <Badge color={STATUS[sk]?.color}>{STATUS[sk]?.label}</Badge>
      </div>
      <div className="flex gap-2">
        <Stat label="pending" value={String(sizes.high + sizes.normal + sizes.low)} />
        <Stat label="done" value={String(s?.completed ?? 0)} />
        <Stat label="thr/s" value={(m?.throughputPerSec ?? 0).toFixed(1)} />
        <Stat label="latency" value={fmtMs(m?.avgTotalMillis ?? 0)} />
      </div>

      <Card>
        <CardHeader className="p-3 pb-0">
          <CardTitle className="text-sm">throughput</CardTitle>
        </CardHeader>
        <CardContent className="p-3">
          <ResponsiveContainer width="100%" height={140}>
            <AreaChart data={history as Array<{ t: number; throughput: number; latency: number }>}>
              <defs>
                <linearGradient id="thr" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22c55e" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="t" hide />
              <YAxis hide />
              <Tooltip
                contentStyle={{ background: "#1e2636", border: "1px solid #2b3650", borderRadius: 8, fontSize: 12 }}
              />
              <Area type="monotone" dataKey="throughput" stroke="#22c55e" fill="url(#thr)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => props.bundle.pause()}>
          pause
        </Button>
        <Button variant="outline" size="sm" onClick={() => props.bundle.resume()}>
          resume
        </Button>
        <Button variant="outline" size="sm" onClick={() => props.bundle.clear()}>
          clear
        </Button>
        <Button variant="destructive" size="sm" onClick={() => props.bundle.shutdown()}>
          shutdown
        </Button>
      </div>

      <div className="text-xs text-muted-foreground">
        LOGS <span className="text-[#22c55e]">live</span> · phase {s?.phase ?? "?"}
      </div>
      <div ref={logRef} className="flex-1 overflow-auto rounded-md border bg-card p-2 text-xs">
        {logs.map((l: LogLine) => (
          <div key={l.id} className="flex gap-2">
            <span className="w-20 shrink-0 text-muted-foreground">
              {new Date(l.t).toLocaleTimeString()}
            </span>
            <span className="w-14 shrink-0" style={{ color: LEVEL[l.level] ?? "#cbd5e1" }}>
              {l.level}
            </span>
            <span className="break-all">{l.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export const DesktopDashboard = (): React.ReactElement => {
  const [group, setGroup] = React.useState<Group>(TREE);
  const [selected, setSelected] = React.useState<string | null>(null);
  const selectedBundle = selected === null ? undefined : REGISTRY[selected];

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-2 border-b px-4 py-2">
        <span className="font-semibold">⬢ {displayName(group.name)}</span>
        <span className="text-xs text-muted-foreground">· {leafIds(group).length} queues</span>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="w-56 shrink-0 overflow-auto border-r p-2">
          <TreeNode
            node={TREE}
            depth={0}
            activeGroup={group.name}
            onGroup={setGroup}
            onQueue={setSelected}
          />
        </aside>
        <main className="min-w-0 flex-1 overflow-auto">
          <FleetTable group={group} selected={selected} onSelect={setSelected} />
        </main>
        {selected !== null && selectedBundle !== undefined ? (
          <section className="w-96 shrink-0 border-l">
            <Detail key={selected} id={selected} bundle={selectedBundle} />
          </section>
        ) : null}
      </div>
    </div>
  );
};
