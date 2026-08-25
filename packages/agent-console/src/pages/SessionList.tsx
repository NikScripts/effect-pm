import * as React from "react";
import type { Session } from "@opencode-ai/sdk";
import * as Router from "last-ts/Router";
import { client } from "../opencode/client";
import { Link, urls } from "../site";

export const SessionList = (): React.ReactElement => {
  const router = Router.useRouter();
  const [sessions, setSessions] = React.useState<ReadonlyArray<Session>>([]);
  const [loading, setLoading] = React.useState(true);

  const refresh = React.useCallback(async (): Promise<void> => {
    setLoading(true);
    const { data } = await client.session.list();
    setSessions(data ?? []);
    setLoading(false);
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const createSession = async (): Promise<void> => {
    const { data } = await client.session.create({});
    if (data === undefined) return;
    router.go(urls.session(data.id));
  };

  return (
    <div className="session-list">
      <header>
        <h1>Sessions</h1>
        <button type="button" onClick={() => void createSession()}>
          New session
        </button>
      </header>
      {loading ? <p>Loading…</p> : null}
      <ul>
        {sessions.map((session) => (
          <li key={session.id}>
            <Link to={(u) => u.session(session.id)}>
              {session.title || session.id}
            </Link>
          </li>
        ))}
      </ul>
      {!loading && sessions.length === 0 ? (
        <p className="empty">No sessions yet — start one above.</p>
      ) : null}
    </div>
  );
};
