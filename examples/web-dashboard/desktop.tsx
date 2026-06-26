/**
 * @module examples/web-dashboard/desktop
 *
 * Wide-screen, VS Code-style layout: resizable left (group tree), center (a live
 * sortable TanStack Table of the group's queues), bottom (the selected queue's log
 * stream), right (its detail: stats + chart + controls). Tag-driven — the tree is the
 * `Fleet` group tag; the table reads the tag-derived `fleetAtom`.
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
import { AsyncResult } from "effect/unstable/reactivity";
import { Group } from "../../src/Group";
import { Fleet } from "./fleet";
import {
  type FleetRow,
  type GroupNode,
  type LeafTag,
  blankRow,
  fleetAtom,
  leafTags,
  queueLeaves,
  queueBundle,
} from "./queue-data";
import { useAtomValue } from "../queue-widget/atom-react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./components/ui/resizable";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./components/ui/table";
import {
  LogStream,
  MetricChart,
  QueueControls,
  QueueStats,
  StatusBadge,
  displayName,
  fmtMs,
} from "./widgets";
import { cn } from "./lib/utils";

const TreeNode = (props: {
  readonly node: GroupNode;
  readonly depth: number;
  readonly activeGroup: string;
  readonly onGroup: (g: GroupNode) => void;
}): React.ReactElement => {
  const { node, depth } = props;
  const subs = Object.values(Group.members(node)).filter((m): m is GroupNode => Group.isGroup(m));
  return (
    <div>
      <button
        type="button"
        onClick={() => props.onGroup(node)}
        className={cn(
          "flex w-full items-center gap-1 rounded-md px-2 py-1 text-left text-sm hover:bg-accent",
          props.activeGroup === node.id && "bg-accent text-accent-foreground",
        )}
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        <span className="text-[#06b6d4]">▸</span>
        <span className="truncate">{displayName(node.id)}</span>
      </button>
      {subs.map((sg) => (
        <TreeNode key={sg.id} {...props} node={sg} depth={depth + 1} />
      ))}
    </div>
  );
};

const columns: ReadonlyArray<ColumnDef<FleetRow>> = [
  {
    id: "queue",
    header: "queue",
    accessorFn: (r) => r.tag.id,
    cell: (c) => <span className="font-medium text-foreground">{displayName(c.row.original.tag.id)}</span>,
  },
  {
    id: "status",
    header: "status",
    accessorFn: (r) => r.phase,
    cell: (c) => <StatusBadge phase={c.row.original.phase} paused={c.row.original.paused} />,
  },
  { accessorKey: "pending", header: "pending" },
  { accessorKey: "inFlight", header: "in-flight" },
  { accessorKey: "completed", header: "done" },
  { accessorKey: "throughput", header: "thr/s", cell: (c) => c.row.original.throughput.toFixed(1) },
  { accessorKey: "latency", header: "latency", cell: (c) => fmtMs(c.row.original.latency) },
];

const FleetTable = (props: {
  readonly group: GroupNode;
  readonly selected: LeafTag | null;
  readonly onSelect: (tag: LeafTag) => void;
}): React.ReactElement => {
  const fleetR = useAtomValue(fleetAtom);
  const fleet = AsyncResult.isSuccess(fleetR) ? fleetR.value : {};
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const leaves = queueLeaves(props.group);
  const data = React.useMemo(
    () => leaves.map((tag) => fleet[tag.id] ?? blankRow(tag)),
    [fleet, leaves],
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
              <TableHead key={h.id} onClick={h.column.getToggleSortingHandler()} className="cursor-pointer select-none">
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
            key={r.original.tag.id}
            data-selected={r.original.tag.id === props.selected?.id}
            onClick={() => props.onSelect(r.original.tag)}
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

export const DesktopDashboard = (): React.ReactElement => {
  // tags/groups are classes (functions) — lazy-init + functional setters so React
  // doesn't mistake them for updater functions and call the constructor.
  const [group, setGroup] = React.useState<GroupNode>(() => Fleet);
  const [selected, setSelected] = React.useState<LeafTag | null>(null);
  const bundle = selected === null ? undefined : queueBundle(selected);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-2 border-b px-4 py-2">
        <span className="font-semibold">⬢ {displayName(group.id)}</span>
        <span className="text-xs text-muted-foreground">· {leafTags(group).length} queues</span>
        {selected !== null ? (
          <span className="ml-auto text-xs text-muted-foreground">{displayName(selected.id)}</span>
        ) : null}
      </header>
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize={16} minSize={10} className="overflow-auto p-2">
          <TreeNode node={Fleet} depth={0} activeGroup={group.id} onGroup={(g) => setGroup(() => g)} />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={56} minSize={30}>
          <ResizablePanelGroup orientation="vertical">
            <ResizablePanel defaultSize={62} minSize={20} className="overflow-auto">
              <FleetTable group={group} selected={selected} onSelect={(tag) => setSelected(() => tag)} />
            </ResizablePanel>
            <ResizableHandle vertical />
            <ResizablePanel defaultSize={38} minSize={10} className="flex min-h-0 flex-col">
              <div className="border-b px-3 py-1 text-xs text-muted-foreground">
                LOGS{selected !== null ? ` · ${displayName(selected.id)}` : ""}
              </div>
              {bundle === undefined ? (
                <div className="grid flex-1 place-items-center text-xs text-muted-foreground">select a queue</div>
              ) : (
                <LogStream bundle={bundle} className="flex-1 py-1" />
              )}
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={28} minSize={16} className="overflow-auto">
          {bundle === undefined || selected === null ? (
            <div className="grid h-full place-items-center p-4 text-center text-sm text-muted-foreground">
              select a queue to see its metrics
            </div>
          ) : (
            <div className="flex flex-col gap-3 p-3">
              <div className="flex items-center gap-2">
                <span className="flex-1 truncate font-semibold">{displayName(selected.id)}</span>
              </div>
              <QueueStats bundle={bundle} />
              <div className="rounded-xl border bg-card p-3"><MetricChart bundle={bundle} /></div>
              <QueueControls bundle={bundle} />
            </div>
          )}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
};
