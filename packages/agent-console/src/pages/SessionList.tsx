import * as React from "react";
import type { Session } from "@opencode-ai/sdk";
import * as Router from "last-ts/Router";
import { client } from "../opencode/client";
import { Link, urls } from "../site";

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

export const SessionList = (): React.ReactElement => {
  const router = Router.useRouter();
  const [sessions, setSessions] = React.useState<ReadonlyArray<Session>>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | undefined>(undefined);

  const refresh = React.useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(undefined);
    try {
      const { data } = await client.session.list();
      setSessions(data ?? []);
    } catch {
      // Server unreachable / restarting — surface it instead of leaving the
      // "Loading…" state stuck forever with no way to recover.
      setError("Couldn't reach the OpenCode server.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const createSession = async (): Promise<void> => {
    try {
      const { data } = await client.session.create({});
      if (data === undefined) return;
      router.go(urls.session(data.id));
    } catch {
      setError("Couldn't start a session — is the OpenCode server running?");
    }
  };

  const sorted = [...sessions].sort((a, b) => b.time.updated - a.time.updated);

  return (
    <div className="session-list">
      <header className="list-header">
        <h1>Sessions</h1>
        <button type="button" className="new-session-button" onClick={() => void createSession()}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              d="M12 5v14M5 12h14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
            />
          </svg>
          New chat
        </button>
      </header>
      {loading ? <p className="hint">Loading…</p> : null}
      {error !== undefined ? (
        <div className="error-banner">
          {error}{" "}
          <button type="button" onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      ) : null}
      <ul>
        {sorted.map((session) => (
          <li key={session.id}>
            <Link to={(u) => u.session(session.id)}>
              <span className="session-title">{session.title || session.id}</span>
              <span className="session-time">{timeAgo(session.time.updated)}</span>
            </Link>
          </li>
        ))}
      </ul>
      {!loading && error === undefined && sessions.length === 0 ? (
        <p className="hint">No sessions yet — start one above.</p>
      ) : null}
    </div>
  );
};
