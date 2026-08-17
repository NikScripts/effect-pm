/**
 * @module web/resourcePages
 *
 * Page-sized logs / schedule chrome for WorkPool + Daemon View **Page** skins.
 * Shared by detail inline LogBox and fullscreen `/…/logs` · `/…/schedule` routes.
 *
 * @public
 */
import * as React from "react";
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, Plus, Trash2 } from "lucide-react";
import type { DaemonTag, QueueBundle, QueueTag } from "../ui/data";
import { isDaemonTag } from "../ui/data";
import * as DaemonView from "../ui/DaemonView";
import * as WorkPoolView from "../ui/WorkPoolView";
import * as Observe from "../Observe";
import { fmtDayLabel, now, startOfWeekMillis } from "../ui/now";
import { useViewTransitionStyle } from "./useViewTransition";
import { Button } from "./components/ui/button";
import {
  ConfirmDialog,
  LockToggle,
  LogStream,
  WeekSchedule,
  WindowDialog,
  displayName,
  useScheduleEdit,
} from "./widgets";

/**
 * Log panel — named element `"log-panel"` for view transitions between detail + fullscreen.
 *
 * @public
 */
export const LogBox = (props: {
  readonly bundle: { readonly logs: QueueBundle["logs"] };
  readonly full: boolean;
  readonly onToggle: () => void;
  readonly meta?: React.ReactNode;
}): React.ReactElement => {
  const vt = useViewTransitionStyle("log-panel");
  return (
    <div
      style={vt}
      className={
        props.full
          ? "fixed inset-0 z-50 flex flex-col gap-2 bg-background p-2 safe-area"
          : "flex min-h-0 flex-1 flex-col gap-1 landscape:min-h-[200px] landscape:max-h-[45dvh]"
      }
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>
          LOGS <span className="text-[#22c55e]">live</span>
          {props.meta}
        </span>
        <button
          type="button"
          onClick={props.onToggle}
          className="ml-auto rounded p-1 hover:bg-accent"
          title={props.full ? "exit fullscreen" : "fullscreen logs"}
          aria-label={props.full ? "exit fullscreen logs" : "fullscreen logs"}
        >
          {props.full ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </button>
      </div>
      <LogStream bundle={props.bundle} className="min-h-0 flex-1 rounded-md border bg-card py-1" />
    </div>
  );
};

const DaemonLogsPage = (props: {
  readonly tag: DaemonTag;
  readonly onClose: () => void;
}): React.ReactElement => {
  const bundle = Observe.use(props.tag, DaemonView.pack);
  return (
    <LogBox
      bundle={bundle}
      full
      onToggle={props.onClose}
      meta={<> · {displayName(props.tag.key)}</>}
    />
  );
};

const QueueLogsPage = (props: {
  readonly tag: QueueTag;
  readonly onClose: () => void;
}): React.ReactElement => {
  const bundle = Observe.use(props.tag, WorkPoolView.pack);
  return (
    <LogBox
      bundle={bundle}
      full
      onToggle={props.onClose}
      meta={<> · {displayName(props.tag.key)}</>}
    />
  );
};

/** Fullscreen logs page — route `/…/<member>/logs`. @public */
export const LogsPage = (props: {
  readonly tag: QueueTag | DaemonTag;
  readonly onClose: () => void;
}): React.ReactElement =>
  isDaemonTag(props.tag) ? (
    <DaemonLogsPage tag={props.tag} onClose={props.onClose} />
  ) : (
    <QueueLogsPage tag={props.tag} onClose={props.onClose} />
  );

const DAY_MS = 86_400_000;

/** Fullscreen weekly schedule — route `/…/<daemon>/schedule`. @public */
export const SchedulePage = (props: {
  readonly tag: DaemonTag;
  readonly onClose: () => void;
}): React.ReactElement => {
  const bundle = Observe.use(props.tag, DaemonView.pack);
  const { list, addEntry, update, remove, clearAll } = useScheduleEdit(bundle);
  const [weekStart, setWeekStart] = React.useState(() => startOfWeekMillis(now()));
  const [editing, setEditing] = React.useState<number | "new" | undefined>(undefined);
  const [confirmClear, setConfirmClear] = React.useState(false);
  const [locked, setLocked] = React.useState(true);
  const vt = useViewTransitionStyle("schedule-panel");
  const thisWeek = startOfWeekMillis(now());
  const initialEntry = typeof editing === "number" ? list[editing] : undefined;
  return (
    <div style={vt} className="fixed inset-0 z-50 flex flex-col gap-2 bg-background p-2 safe-area">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={props.onClose}>
          ← back
        </Button>
        <strong className="flex-1 truncate text-base">Schedule</strong>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setWeekStart((w) => w - 7 * DAY_MS)}
          aria-label="previous week"
        >
          <ChevronLeft className="size-4" />
        </Button>
        <button
          type="button"
          onClick={() => setWeekStart(thisWeek)}
          className="flex-1 text-center leading-tight"
        >
          <div className="text-sm font-semibold">Week of {fmtDayLabel(weekStart)}</div>
          <div className="text-xs text-muted-foreground">
            {weekStart === thisWeek ? "This week" : "Jump to this week"}
          </div>
        </button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setWeekStart((w) => w + 7 * DAY_MS)}
          aria-label="next week"
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
      <WeekSchedule
        entries={list}
        weekStart={weekStart}
        onSelectEntry={locked ? undefined : (i) => setEditing(i)}
      />
      <div className="flex items-center justify-center gap-2 border-t pt-2">
        <Button variant="outline" size="sm" onClick={() => setEditing("new")} disabled={locked}>
          <Plus className="size-4" /> add
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setConfirmClear(true)}
          disabled={locked || list.length === 0}
        >
          <Trash2 className="size-4" /> clear
        </Button>
        <LockToggle locked={locked} onToggle={() => setLocked((l) => !l)} />
      </div>
      <WindowDialog
        open={editing !== undefined}
        onOpenChange={(open) => {
          if (!open) setEditing(undefined);
        }}
        initial={initialEntry}
        onSubmit={(entry) => {
          if (editing === "new") addEntry(entry);
          else if (typeof editing === "number") update(editing, entry);
        }}
        onDelete={typeof editing === "number" ? () => remove(editing) : undefined}
      />
      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear schedule?"
        description="Remove all run windows. The daemon disarms until new windows are added."
        confirmLabel="Clear"
        destructive
        onConfirm={clearAll}
      />
    </div>
  );
};
