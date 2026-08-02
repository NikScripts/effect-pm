/**
 * Vision prototype — composable View kit + thin Dashboard shell.
 *
 * STEAL (already in the library / design):
 * - Parent-owned nav (W9) + ChromeProvider callbacks
 * - Group card = card for a Group tag (not a special Dashboard widget)
 * - Detail body-only; shell owns back / title
 *
 * WILD extras (value probes — keep only if they earn a place):
 * 1. ⌘K jump palette — Linear/Raycast steal
 * 2. PiP live logs — float while navigating
 * 3. Lineage crumb — LogContext lineage, not the URL path
 * 4. Ghost scrubber — drag readiness history to a past beat
 * 5. Pin-compare — park two tags side-by-side
 */
import * as React from "react";
import { findById, flatten, hub, seedLogs, type Member } from "./mock";

import * as View from "../../../src/ui/View";
type Route =
  | { readonly _tag: "grid"; readonly groupId: string }
  | { readonly _tag: "detail"; readonly groupId: string; readonly leafId: string };

/** STEAL: Chrome — parent supplies nav; skins only read it. */
type Chrome = {
  readonly onBack?: () => void;
  readonly onOpen?: (id: string) => void;
  readonly onPin?: (id: string) => void;
};

const ChromeCtx = React.createContext<Chrome>({});
const useChrome = (): Chrome => React.useContext(ChromeCtx);

const ChromeProvider = (props: {
  readonly value: Chrome;
  readonly children: React.ReactNode;
}): React.ReactElement => (
  <ChromeCtx.Provider value={props.value}>{props.children}</ChromeCtx.Provider>
);

const kindLabel = (k: Member["kind"]): string =>
  k === "group" ? "group" : k === "queue" ? "queue" : k === "daemon" ? "daemon" : "gate";

const Spark = (props: {
  readonly spark: ReadonlyArray<number>;
  readonly ghostAt?: number;
}): React.ReactElement => (
  <div className="spark" aria-hidden>
    {props.spark.map((v, i) => (
      <i
        key={i}
        className={props.ghostAt === i ? "ghost" : undefined}
        style={{ height: `${Math.max(14, v * 100)}%` }}
      />
    ))}
  </div>
);

/** STEAL: GroupCard shape — same interaction surface as a leaf card. */
const GroupCardView = (props: { readonly member: Member }): React.ReactElement => {
  const chrome = useChrome();
  const kids = props.member.children ?? [];
  const degraded = kids.filter((c) => !c.ready).length;
  return (
    <button
      type="button"
      className={`card group ${degraded > 0 ? "degraded" : ""}`}
      onClick={() => chrome.onOpen?.(props.member.id)}
    >
      <div className="card-head">
        <strong>▸ {props.member.name}</strong>
        {degraded > 0 ? (
          <span className="badge warn">
            {degraded}/{kids.length} degraded
          </span>
        ) : (
          <span className="badge">{kids.length} resources</span>
        )}
      </div>
      <div className="members">
        {kids.slice(0, 4).map((c) => (
          <div key={c.id} className="row">
            <span>
              {c.kind === "group" ? "▸ " : ""}
              {c.name}
            </span>
            <span className={`pip ${c.ready ? "" : "bad"}`} />
          </div>
        ))}
      </div>
      <div className="card-foot">
        <span>View.Card · group</span>
        <Spark spark={props.member.spark} />
      </div>
    </button>
  );
};

/** STEAL: leaf card — body only; open via chrome. */
const LeafCardView = (props: {
  readonly member: Member;
  readonly pinned?: boolean;
}): React.ReactElement => {
  const chrome = useChrome();
  return (
    <button
      type="button"
      className={`card ${props.member.ready ? "" : "degraded"} ${props.pinned === true ? "pinned" : ""}`}
      onClick={() => chrome.onOpen?.(props.member.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        chrome.onPin?.(props.member.id);
      }}
    >
      <div className="card-head">
        <strong>{props.member.name}</strong>
        <span className="badge">{kindLabel(props.member.kind)}</span>
        <span className={`badge ${props.member.ready ? "ok" : "warn"}`}>
          {props.member.ready ? "ready" : "degraded"}
        </span>
      </div>
      <div className="members">
        <div className="row">
          <span>{props.member.detail ?? props.member.id}</span>
        </div>
      </div>
      <div className="card-foot">
        <span>View.Card · right-click pin</span>
        <Spark spark={props.member.spark} />
      </div>
    </button>
  );
};

/** STEAL: detail body — no back button here; shell chrome owns that. */
const LeafDetailBody = (props: {
  readonly member: Member;
  readonly ghostAt: number;
  readonly onGhost: (i: number) => void;
}): React.ReactElement => {
  const v = props.member.spark[props.ghostAt] ?? 1;
  const pastReady = v >= 0.85;
  return (
    <div className="detail-body">
      <div>
        <span className="tag">view skin</span>
        <p style={{ margin: "0.5rem 0 0", color: "var(--fog)", fontSize: "0.85rem" }}>
          Body-only detail. Header / back / route live in the thin shell — same contract whether
          this mounts inside Dashboard or alone under a <code>ChromeProvider</code>.
        </p>
      </div>

      <div className="scrub">
        <label>
          <span className="tag" style={{ color: "var(--warn)" }}>
            wild · ghost scrubber
          </span>
          <span>
            beat {props.ghostAt + 1}/{props.member.spark.length}
          </span>
        </label>
        <input
          type="range"
          min={0}
          max={props.member.spark.length - 1}
          value={props.ghostAt}
          onChange={(e) => props.onGhost(Number(e.target.value))}
        />
        <div className="scrub-readout">
          At this beat:{" "}
          <strong style={{ color: pastReady ? "var(--signal)" : "var(--warn)" }}>
            {pastReady ? "would read ready" : "would read degraded"}
          </strong>{" "}
          ({Math.round(v * 100)}% readiness)
          <div style={{ marginTop: "0.45rem" }}>
            <Spark spark={props.member.spark} ghostAt={props.ghostAt} />
          </div>
        </div>
      </div>

      <div>
        <div className="tag">lineage (steal · LogContext)</div>
        <div className="crumb" style={{ marginTop: "0.4rem", marginBottom: 0 }}>
          {props.member.lineage.map((seg, i) => (
            <React.Fragment key={seg}>
              {i > 0 ? <span className="sep">/</span> : null}
              <span>{seg}</span>
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
};

const JumpPalette = (props: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onPick: (id: string) => void;
}): React.ReactElement | null => {
  const [q, setQ] = React.useState("");
  const [active, setActive] = React.useState(0);
  const items = React.useMemo(() => {
    const all = flatten(hub);
    const needle = q.trim().toLowerCase();
    return needle === ""
      ? all
      : all.filter(
          (m) =>
            m.name.toLowerCase().includes(needle) || m.id.toLowerCase().includes(needle),
        );
  }, [q]);

  React.useEffect(() => {
    if (!props.open) {
      setQ("");
      setActive(0);
    }
  }, [props.open]);

  React.useEffect(() => {
    setActive(0);
  }, [q]);

  if (!props.open) return null;

  return (
    <div
      className="palette-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div
        className="palette"
        role="dialog"
        aria-label="Jump to"
        onKeyDown={(e) => {
          if (e.key === "Escape") props.onClose();
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, items.length - 1));
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          }
          if (e.key === "Enter" && items[active] !== undefined) {
            props.onPick(items[active]!.id);
          }
        }}
      >
        <input
          autoFocus
          placeholder="Jump to group / queue / daemon…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <ul>
          {items.map((m, i) => (
            <li key={m.id}>
              <button
                type="button"
                className={i === active ? "active" : undefined}
                onMouseEnter={() => setActive(i)}
                onClick={() => props.onPick(m.id)}
              >
                <span>
                  {m.kind === "group" ? "▸ " : ""}
                  {m.name}
                </span>
                <span className="meta">
                  {kindLabel(m.kind)} · {m.id}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

const PipLogs = (props: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly filterLineage?: string;
}): React.ReactElement | null => {
  const [lines, setLines] = React.useState(seedLogs);
  React.useEffect(() => {
    if (!props.open) return;
    const id = window.setInterval(() => {
      const tick = new Date();
      const t = tick.toTimeString().slice(0, 8);
      const pool = ["wnba/BoxScoreQueue", "wnba/ImportJobs", "wnba/LiveScorePoller", "ops/DrainQueue"];
      const target = pool[tick.getSeconds() % pool.length]!;
      setLines((prev) =>
        [
          ...prev.slice(-40),
          {
            t,
            level: tick.getSeconds() % 11 === 0 ? ("WARN" as const) : ("INFO" as const),
            msg: `heartbeat ${target.split("/").pop()}`,
            lineage: [target],
          },
        ],
      );
    }, 1200);
    return () => window.clearInterval(id);
  }, [props.open]);

  if (!props.open) return null;
  const shown =
    props.filterLineage === undefined
      ? lines
      : lines.filter((l) => l.lineage.some((x) => x.includes(props.filterLineage!)));

  return (
    <aside className="pip-log">
      <header>
        <span>
          wild · PiP logs
          {props.filterLineage !== undefined ? ` · filter ${props.filterLineage}` : ""}
        </span>
        <button type="button" className="chip" onClick={props.onClose}>
          close
        </button>
      </header>
      <pre>
        {shown.map((l, i) => (
          <div key={`${l.t}-${i}`} className={`lvl-${l.level}`}>
            {l.t} {l.level.padEnd(5)} {l.msg}{" "}
            <span style={{ opacity: 0.55 }}>{l.lineage.join(" › ")}</span>
          </div>
        ))}
      </pre>
    </aside>
  );
};

export const App = (): React.ReactElement => {
  const [route, setRoute] = React.useState<Route>({ _tag: "grid", groupId: hub.id });
  const [palette, setPalette] = React.useState(false);
  const [pip, setPip] = React.useState(true);
  const [pins, setPins] = React.useState<ReadonlyArray<string>>([]);
  const [ghostAt, setGhostAt] = React.useState(7);

  const group = findById(hub, route.groupId) ?? hub;
  const leaf =
    route._tag === "detail" ? findById(hub, route.leafId) : undefined;

  const openId = React.useCallback((id: string) => {
    const m = findById(hub, id);
    if (m === undefined) return;
    if (m.kind === "group") {
      setRoute({ _tag: "grid", groupId: m.id });
    } else {
      const parent = m.lineage.length >= 2 ? m.lineage[m.lineage.length - 2]! : hub.id;
      setRoute({ _tag: "detail", groupId: parent, leafId: m.id });
      setGhostAt(m.spark.length - 1);
    }
    setPalette(false);
  }, []);

  const pinId = React.useCallback((id: string) => {
    setPins((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      return [...prev.slice(-1), id];
    });
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
      if (meta && e.key.toLowerCase() === "l") {
        e.preventDefault();
        setPip((p) => !p);
      }
      if (e.key === "Escape") setPalette(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const lineage =
    leaf?.lineage ??
    group.lineage;

  const chrome: Chrome = {
    onBack: () => setRoute({ _tag: "grid", groupId: route.groupId }),
    onOpen: openId,
    onPin: pinId,
  };

  return (
    <div className="proto">
      <header className="topbar">
        <div className="brand">
          hyperlink <em>compose</em>
        </div>
        <span className="steal">steal: View + Chrome · invent only if damn good</span>
        <div className="topbar-actions">
          <button type="button" className="chip hot" onClick={() => setPalette(true)}>
            Jump <span className="kbd">⌘K</span>
          </button>
          <button type="button" className={`chip ${pip ? "hot" : ""}`} onClick={() => setPip((p) => !p)}>
            PiP logs <span className="kbd">⌘L</span>
          </button>
        </div>
      </header>

      <div className={`shell ${pins.length > 0 ? "compare-on" : ""}`}>
        <main className="main">
          <div className="legend">
            <span className="shell-owned">shell-owned · route / overlays / chrome</span>
            <span className="view-skin">view skin · GroupCard / LeafCard / Detail body</span>
            <span className="wild">wild · jump · PiP · ghost · pin-compare</span>
          </div>

          <nav className="crumb" aria-label="Lineage">
            {lineage.map((seg, i) => {
              const isLast = i === lineage.length - 1;
              return (
                <React.Fragment key={seg}>
                  {i > 0 ? <span className="sep">›</span> : null}
                  {isLast ? (
                    <strong>{seg.split("/").pop()}</strong>
                  ) : (
                    <button type="button" onClick={() => openId(seg)}>
                      {seg.split("/").pop()}
                    </button>
                  )}
                </React.Fragment>
              );
            })}
            <span className="note">lineage crumb · not the URL path</span>
          </nav>

          <ChromeProvider value={chrome}>
            {route._tag === "grid" ? (
              <div className="grid">
                {(group.children ?? []).map((m) =>
                  m.kind === "group" ? (
                    <GroupCardView key={m.id} member={m} />
                  ) : (
                    <LeafCardView
                      key={m.id}
                      member={m}
                      pinned={pins.includes(m.id)}
                    />
                  ),
                )}
              </div>
            ) : leaf !== undefined ? (
              <section className="detail">
                <div className="detail-chrome">
                  <button type="button" className="chip" onClick={chrome.onBack}>
                    ← back
                  </button>
                  <h1>{leaf.name}</h1>
                  <span className={`badge ${leaf.ready ? "ok" : "warn"}`}>
                    {leaf.ready ? "ready" : "degraded"}
                  </span>
                  <button type="button" className="chip" onClick={() => pinId(leaf.id)}>
                    {pins.includes(leaf.id) ? "unpin" : "pin compare"}
                  </button>
                  <span className="tag" style={{ marginLeft: "auto" }}>
                    shell chrome
                  </span>
                </div>
                <LeafDetailBody member={leaf} ghostAt={ghostAt} onGhost={setGhostAt} />
              </section>
            ) : null}
          </ChromeProvider>
        </main>

        {pins.length > 0 ? (
          <aside className="compare">
            <h2>wild · pin-compare</h2>
            <p className="empty">Right-click a card or pin from detail. Max two.</p>
            {[0, 1].map((slot) => {
              const id = pins[slot];
              const m = id !== undefined ? findById(hub, id) : undefined;
              return (
                <div key={slot} className={`slot ${m !== undefined ? "filled" : ""}`}>
                  {m === undefined ? (
                    <span className="empty">empty slot</span>
                  ) : (
                    <>
                      <div className="card-head">
                        <strong style={{ fontFamily: "var(--font-display)" }}>{m.name}</strong>
                        <button type="button" className="chip" onClick={() => pinId(m.id)}>
                          ×
                        </button>
                      </div>
                      <div className="members" style={{ marginTop: "0.4rem" }}>
                        <div className="row">
                          <span>{m.ready ? "ready" : m.detail ?? "degraded"}</span>
                          <span className={`pip ${m.ready ? "" : "bad"}`} />
                        </div>
                      </div>
                      <div style={{ marginTop: "0.55rem" }}>
                        <Spark spark={m.spark} />
                      </div>
                      <button
                        type="button"
                        className="chip"
                        style={{ marginTop: "0.55rem" }}
                        onClick={() => openId(m.id)}
                      >
                        open
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </aside>
        ) : null}
      </div>

      <JumpPalette open={palette} onClose={() => setPalette(false)} onPick={openId} />
      <PipLogs
        open={pip}
        onClose={() => setPip(false)}
        filterLineage={leaf?.id.split("/").pop()}
      />
    </div>
  );
};
