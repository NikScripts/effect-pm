/**
 * Extracted from SessionList.tsx once it needed reuse across Home and
 * RepoSessions, not before — a one-off inline component wasn't worth
 * pulling out until there were multiple call sites.
 *
 * Two contexts, two badge shapes: Home shows repo+worktree together (you
 * could be looking at any repo); RepoSessions shows just the worktree (the
 * repo's already the page you're on) — pass `repo` only from Home.
 *
 * @internal
 */
import * as React from "react";
import type { Session } from "@opencode-ai/sdk";
import type { SessionDetail } from "../opencode/useSessionDetails";

const timeAgo = (ms: number): string => {
  const seconds = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

const formatTokens = (n: number): string => {
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
};

const formatCost = (n: number): string => (n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`);

const SessionStats = (props: {
  readonly detail: SessionDetail | undefined;
}): React.ReactElement | null => {
  const detail = props.detail;
  if (detail === undefined) return null;
  return (
    <div className="session-stats">
      {detail.status === "busy" || detail.status === "retry" ? (
        <span className="status-active" title={detail.status}>
          <span className="status-dot" />
          {detail.status === "retry" ? "retrying" : "active"}
        </span>
      ) : null}
      <span className="stat-fixed">
        {detail.messageCount}
        {detail.messageCountIsExact ? "" : "+"} msg
      </span>
      {detail.editCount > 0 ? (
        <span className="stat-add stat-fixed">
          {detail.editCount}
          {detail.messageCountIsExact ? "" : "+"} ed
        </span>
      ) : null}
      {detail.contextTokens !== undefined ? (
        <span className="stat-fixed" title="Context window at the last turn">
          {formatTokens(detail.contextTokens)} ctx
        </span>
      ) : null}
      {detail.cost !== undefined && detail.cost > 0 ? (
        <span className="stat-fixed">{formatCost(detail.cost)}</span>
      ) : null}
    </div>
  );
};

export const SessionCard = (props: {
  readonly session: Session;
  readonly detail: SessionDetail | undefined;
  readonly onOpen: (id: string) => void;
  /** Set from Home (browsing across repos) — shown alongside `worktree`. */
  readonly repo?: string;
  /** Set from both Home and RepoSessions — omit only when the session's
   * directory didn't match any known worktree. */
  readonly worktree?: string;
}): React.ReactElement => {
  const { session, detail } = props;
  return (
    <button
      type="button"
      className="session-card"
      style={{ viewTransitionName: `session-${session.id}` }}
      onClick={() => props.onOpen(session.id)}
    >
      <div className="session-card-top">
        <div className="session-card-title">{session.title || session.id}</div>
        {session.parentID !== undefined ? <span className="session-fork-badge">forked</span> : null}
      </div>
      {props.repo !== undefined || props.worktree !== undefined ? (
        <div className="session-card-location">
          {props.repo !== undefined ? <span className="session-repo-badge">{props.repo}</span> : null}
          {props.worktree !== undefined ? (
            <span className="session-worktree-badge">{props.worktree}</span>
          ) : null}
        </div>
      ) : null}
      <div className="session-card-preview">{detail?.preview ?? " "}</div>
      <div className="session-card-meta">
        <SessionStats detail={detail} />
        <span className="session-time">{timeAgo(session.time.updated)}</span>
      </div>
    </button>
  );
};
