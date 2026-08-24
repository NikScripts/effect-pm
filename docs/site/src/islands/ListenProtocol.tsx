"use client";

// Protocol-listen toggle for the overload family. A Djot `​```listen` block becomes this island:
// tabs for http / ws / unix / nPipe, one code panel with every overload form for that sibling.
// Selection persists (localStorage) and syncs across every listen block on the page.

import * as React from "react";
import { CopyButton } from "./CopyButton.js";

const PROTOS = ["http", "ws", "unix", "nPipe"] as const;
type Proto = (typeof PROTOS)[number];

const isProto = (v: unknown): v is Proto =>
  typeof v === "string" && (PROTOS as readonly string[]).includes(v);

const STORAGE_KEY = "docs:listen-proto";
const CHANGE_EVENT = "docs:listen-proto-change";

type Addr = {
  readonly arg: string;
  readonly shorthand: string;
  readonly ephemeral: string;
};

const addrFor = (proto: Proto): Addr => {
  switch (proto) {
    case "http":
      return {
        arg: "3000",
        shorthand: 'or ":3000" or "http://127.0.0.1:3000/rpc"',
        ephemeral: "nameless, ephemeral port, Lookup Soft-baked",
      };
    case "ws":
      return {
        arg: "3000",
        shorthand: 'or ":3000" or "ws://127.0.0.1:3000/rpc"',
        ephemeral: "nameless, ephemeral port, Lookup Soft-baked",
      };
    case "unix":
      return {
        arg: '"/tmp/jobs.sock"',
        shorthand: "path string; omit for ephemeral",
        ephemeral: "nameless, ephemeral sock, Lookup Soft-baked",
      };
    case "nPipe":
      return {
        // runtime path `\\.\pipe\jobs` → TS literal `"\\\\.\\pipe\\jobs"`
        arg: JSON.stringify("\\\\.\\pipe\\jobs"),
        shorthand: "pipe name; omit for ephemeral",
        ephemeral: "nameless, ephemeral pipe, Lookup Soft-baked",
      };
  }
};

const withComment = (code: string, comment: string, width: number): string =>
  `${code.padEnd(width)} // ${comment}`;

/** Every overload form for one protocol sibling — same family, wire-specific address. */
export const codeFor = (proto: Proto): string => {
  const m = `Node.${proto}`;
  const { arg, shorthand, ephemeral } = addrFor(proto);
  const tagged = [
    { code: `${m}(Jobs, jobsImpl)`, comment: ephemeral },
    { code: `${m}(Jobs, jobsImpl, ${arg})`, comment: shorthand },
    { code: `${m}(Jobs, jobsImpl, Worker)`, comment: "named Node Tag" },
    {
      code: `${m}(Hyperlink.serve(Jobs, jobsImpl), ${arg})`,
      comment: "one serve, no array",
    },
    {
      code: `${m}(Worker, Hyperlink.serve(Jobs, jobsImpl), ${arg})`,
      comment: "named Node + serve(s)",
    },
  ];
  const width = Math.max(...tagged.map((l) => l.code.length));
  return [
    "// Tag + Implementation",
    withComment(tagged[0]!.code, tagged[0]!.comment, width),
    withComment(tagged[1]!.code, tagged[1]!.comment, width),
    withComment(tagged[2]!.code, tagged[2]!.comment, width),
    "",
    "// Serve layers on one /rpc",
    withComment(tagged[3]!.code, tagged[3]!.comment, width),
    withComment(`${m}(`, "several HyperServices", width),
    `  [`,
    `    Hyperlink.serve(Jobs, jobsImpl),`,
    `    Hyperlink.serve(Emails, emailsImpl),`,
    `  ],`,
    `  ${arg},`,
    `)`,
    withComment(tagged[4]!.code, tagged[4]!.comment, width),
  ].join("\n");
};

export function ListenProtocol({
  defaultProto,
}: {
  readonly defaultProto?: string;
}): React.ReactElement {
  const initial = isProto(defaultProto) ? defaultProto : "http";
  const [proto, setProto] = React.useState<Proto>(initial);

  React.useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isProto(stored)) setProto(stored);
    const onChange = (e: Event): void => {
      const next = (e as CustomEvent<Proto>).detail;
      if (isProto(next)) setProto(next);
    };
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CHANGE_EVENT, onChange);
  }, []);

  const choose = (next: Proto): void => {
    setProto(next);
    localStorage.setItem(STORAGE_KEY, next);
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: next }));
  };

  const code = codeFor(proto);

  return (
    <div className="pm-install listen-proto">
      <div className="pm-tabs" role="tablist" aria-label="Listen protocol">
        {PROTOS.map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={p === proto}
            className="pm-tab"
            data-active={p === proto ? "" : undefined}
            onClick={() => choose(p)}
          >
            {p}
          </button>
        ))}
      </div>
      <div className="pm-command">
        <code>{code}</code>
        <CopyButton code={code} />
      </div>
    </div>
  );
}
