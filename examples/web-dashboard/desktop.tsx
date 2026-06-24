/**
 * @module examples/web-dashboard/desktop
 *
 * Wide-screen, VS Code-style layout: resizable left (group tree), center (a live
 * sortable TanStack Table of the group's queues), bottom (the selected queue's log
 * stream — like the editor panel), and right (the selected queue's detail: stats +
 * throughput chart + controls). Same `live-queues` data + widgets as mobile.
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
import { REGISTRY, TREE, fleetAtom, type FleetRow, type Group, type Node } from "../resource-tui/live-queues";
import { useAtomValue } from "../queue-widget/atom-react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "./components/ui/resizable";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./components/ui/table";
import {
  LogStream,
  QueueControls,
  QueueStats,
  StatusBadge,
  ThroughputChart,
  displayName,
  fmtMs,
  leafIds,
} from "./widgets";
import { cn } from "./lib/utils";

const TreeNode = (props: {
  readonly node: Node;
  readonly depth: number;
  readonly activeGroup: string;
  readonly selectedQueue: string | null;
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
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground",
        props.selectedQueue === node.name && "bg-accent text-foreground",
      )}
      style={{ paddingLeft: 16 + depth * 12 }}
    >
      <span className="truncate">{displayName(node.name)}</span>
    </button>
  );
};

const columns: ReadonlyArray<ColumnDef<FleetRow>> = [
  {
    accessorKey: "id",
    header: "queue",
    cell: (c) => <span className="font-medium text-foreground">{displayName(c.row.original.id)}</span>,
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

export const DesktopDashboard = (): React.ReactElement => {
  const [group, setGroup] = React.useState<Group>(TREE);
  const [selected, setSelected] = React.useState<string | null>(null);
  const bundle = selected === null ? undefined : REGISTRY[selected];

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-2 border-b px-4 py-2">
        <span className="font-semibold">⬢ {displayName(group.name)}</span>
        <span className="text-xs text-muted-foreground">· {leafIds(group).length} queues</span>
        {selected !== null ? (
          <span className="ml-auto text-xs text-muted-foreground">{displayName(selected)}</span>
        ) : null}
      </header>
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize={16} minSize={10} className="overflow-auto p-2">
          <TreeNode
            node={TREE}
            depth={0}
            activeGroup={group.name}
            selectedQueue={selected}
            onGroup={setGroup}
            onQueue={setSelected}
          />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={56} minSize={30}>
          <ResizablePanelGroup orientation="vertical">
            <ResizablePanel defaultSize={62} minSize={20} className="overflow-auto">
              <FleetTable group={group} selected={selected} onSelect={setSelected} />
            </ResizablePanel>
            <ResizableHandle vertical />
            <ResizablePanel defaultSize={38} minSize={10} className="flex min-h-0 flex-col">
              <div className="border-b px-3 py-1 text-xs text-muted-foreground">
                LOGS{selected !== null ? ` · ${displayName(selected)}` : ""}
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
          {bundle === undefined ? (
            <div className="grid h-full place-items-center p-4 text-center text-sm text-muted-foreground">
              select a queue to see its metrics
            </div>
          ) : (
            <div className="flex flex-col gap-3 p-3">
              <div className="flex items-center gap-2">
                <span className="flex-1 truncate font-semibold">{displayName(selected!)}</span>
              </div>
              <QueueStats bundle={bundle} />
              <div className="rounded-xl border bg-card p-3">
                <div className="mb-1 text-sm font-semibold">throughput</div>
                <ThroughputChart bundle={bundle} />
              </div>
              <QueueControls bundle={bundle} />
            </div>
          )}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
};
