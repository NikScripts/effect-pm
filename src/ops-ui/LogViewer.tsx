/**
 * Styled log viewer with local toolbar filters.
 *
 * @module ops-ui/LogViewer
 */

import { Fragment, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ProcessManagerLogEntry } from "../LogEntry.js";
import {
  useControlPlaneLogs,
  type DashboardGroupTarget,
  type DashboardProcessTarget,
  type DashboardQueueTarget,
  type DashboardTarget,
} from "../react/index.js";

const logLevels = ["Error", "Warn", "Info", "Debug", "Trace"] as const;
const lineOptions = [50, 100, 250] as const;

type LogLevelFilter = typeof logLevels[number];
type LineCount = typeof lineOptions[number];

type TargetOption = {
  readonly label: string;
  readonly target: DashboardTarget;
};

export type LogViewerProps = {
  readonly for: DashboardGroupTarget;
  readonly processes?: ReadonlyArray<DashboardProcessTarget>;
  readonly queues?: ReadonlyArray<DashboardQueueTarget>;
  readonly lines?: LineCount;
};

const entryMatchesSearch = (
  entry: ProcessManagerLogEntry,
  search: string,
): boolean => {
  if (search.length === 0) {
    return true;
  }
  const haystack = [
    entry.date,
    String(entry.level),
    entry.message,
    entry.cause ?? "",
    ...Object.entries(entry.annotations).flatMap(([key, value]) => [key, value]),
    ...entry.spans,
  ].join(" ").toLowerCase();
  return haystack.includes(search.toLowerCase());
};

const entryMatchesLevels = (
  entry: ProcessManagerLogEntry,
  levels: ReadonlyArray<LogLevelFilter>,
): boolean =>
  levels.length === 0 || levels.some((level) => level === entry.level);

const targetOptions = (
  group: DashboardGroupTarget,
  processes: ReadonlyArray<DashboardProcessTarget>,
  queues: ReadonlyArray<DashboardQueueTarget>,
): ReadonlyArray<TargetOption> => [
  { label: "Group", target: group },
  ...processes.map((process) => ({ label: process.id, target: process })),
  ...queues.map((queue) => ({ label: queue.id, target: queue })),
];

const toggleLevel = (
  levels: ReadonlyArray<LogLevelFilter>,
  level: LogLevelFilter,
): ReadonlyArray<LogLevelFilter> =>
  levels.includes(level)
    ? levels.filter((item) => item !== level)
    : [...levels, level];

/** @public */
export const LogViewer = ({
  for: group,
  processes = [],
  queues = [],
  lines = 100,
}: LogViewerProps) => {
  const options = useMemo(
    () => targetOptions(group, processes, queues),
    [group, processes, queues],
  );
  const [target, setTarget] = useState<DashboardTarget>(() => group);
  const [lineCount, setLineCount] = useState<LineCount>(lines);
  const [follow, setFollow] = useState(true);
  const [search, setSearch] = useState("");
  const [levels, setLevels] = useState<ReadonlyArray<LogLevelFilter>>([]);
  const [clearedAt, setClearedAt] = useState(0);
  const logListRef = useRef<HTMLOListElement | null>(null);
  const logs = useControlPlaneLogs({
    for: target,
    lines: lineCount,
    follow: true,
    enabled: follow,
  });

  const visibleEntries = useMemo(
    () => logs.entries
      .slice(clearedAt)
      .filter((entry) => entryMatchesLevels(entry, levels))
      .filter((entry) => entryMatchesSearch(entry, search)),
    [logs.entries, clearedAt, levels, search],
  );

  useLayoutEffect(() => {
    const list = logListRef.current;
    if (list !== null && follow) {
      list.scrollTop = list.scrollHeight;
    }
  }, [visibleEntries.length, follow]);

  const selectedTargetId = `${target.kind}:${target.id}`;

  return (
    <section
      data-pm-panel="logs"
      data-pm-target-kind={target.kind}
      data-pm-target-id={target.id}
    >
      <header>
        <h2>Logs</h2>
        <p>
          <code>{target.id}</code>
          {logs.loading ? " · loading…" : null}
          {!follow ? " · paused" : null}
        </p>
      </header>

      <div className="pm-dashboard__log-toolbar" aria-label="Log controls">
        <div className="pm-dashboard__log-tabs" role="tablist" aria-label="Log target">
          {options.map((option) => {
            const id = `${option.target.kind}:${option.target.id}`;
            return (
              <button
                type="button"
                aria-selected={selectedTargetId === id}
                data-active={selectedTargetId === id ? "true" : "false"}
                key={id}
                onClick={() => {
                  setTarget(() => option.target);
                  setClearedAt(0);
                }}
                role="tab"
              >
                {option.label}
              </button>
            );
          })}
        </div>

        <div className="pm-dashboard__log-controls">
          <button type="button" onClick={() => setFollow((value) => !value)}>
            {follow ? "Pause" : "Resume"}
          </button>
          <button type="button" onClick={() => setClearedAt(logs.entries.length)}>
            Clear
          </button>
          <label>
            <span>Lines</span>
            <select
              value={lineCount}
              onChange={(event) => {
                setLineCount(Number(event.currentTarget.value) as LineCount);
                setClearedAt(0);
              }}
            >
              {lineOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="pm-dashboard__log-filters" aria-label="Severity filters">
          {logLevels.map((level) => {
            const active = levels.includes(level);
            return (
              <button
                type="button"
                data-active={active ? "true" : "false"}
                key={level}
                onClick={() => setLevels((current) => toggleLevel(current, level))}
              >
                {level}
              </button>
            );
          })}
        </div>

        <label className="pm-dashboard__log-search">
          <span>Search logs</span>
          <input
            type="search"
            placeholder="message, span, annotation…"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
          />
        </label>
      </div>

      {logs.error !== null ? <p role="alert">{logs.error}</p> : null}

      <ol ref={logListRef}>
        {visibleEntries.map((entry, index) => (
          <Fragment key={`${entry.date}:${String(index)}`}>
            <li>
              <time dateTime={entry.date}>{entry.date}</time>
              <span> [{entry.level}] </span>
              <span>{entry.message}</span>
            </li>
          </Fragment>
        ))}
      </ol>

      {visibleEntries.length === 0 && !logs.loading ? <p>No logs matched.</p> : null}
    </section>
  );
};
