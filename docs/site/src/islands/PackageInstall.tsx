"use client";

// Package-manager toggle for install commands. A Djot `​```install` block carries the package list as
// its text; this renders pnpm / npm / yarn / bun tabs and the matching command with a copy button. The
// choice is persisted (localStorage) and synced across every install block on the page (a custom event).

import * as React from "react";
import { CopyButton } from "./CopyButton.js";

const PMS = ["pnpm", "npm", "yarn", "bun"] as const;
type PM = (typeof PMS)[number];

const isPM = (v: unknown): v is PM => typeof v === "string" && (PMS as readonly string[]).includes(v);

// npm installs with `install`; pnpm / yarn / bun with `add`. A leading `-D` in the package spec means a
// dev dependency — emitted as each manager's dev flag (`--dev` for bun, `-D` elsewhere).
const commandFor = (pm: PM, packages: string): string => {
  const dev = /^-D(\s|$)/.test(packages);
  const list = dev ? packages.replace(/^-D\s*/, "") : packages;
  const verb = pm === "npm" ? "install" : "add";
  const devFlag = dev ? (pm === "bun" ? " --dev" : " -D") : "";
  return `${pm} ${verb}${devFlag} ${list}`;
};

const STORAGE_KEY = "docs:pm";
const CHANGE_EVENT = "docs:pm-change";

export function PackageInstall({ packages }: { readonly packages: string }): React.ReactElement {
  const pkgs = packages.trim().replace(/\s+/g, " ");
  const [pm, setPm] = React.useState<PM>("pnpm");

  React.useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isPM(stored)) setPm(stored);
    // keep every install block on the page in sync
    const onChange = (e: Event): void => {
      const next = (e as CustomEvent<PM>).detail;
      if (isPM(next)) setPm(next);
    };
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CHANGE_EVENT, onChange);
  }, []);

  const choose = (next: PM): void => {
    setPm(next);
    localStorage.setItem(STORAGE_KEY, next);
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: next }));
  };

  const command = commandFor(pm, pkgs);

  return (
    <div className="pm-install">
      <div className="pm-tabs" role="tablist" aria-label="Package manager">
        {PMS.map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={p === pm}
            className="pm-tab"
            data-active={p === pm ? "" : undefined}
            onClick={() => choose(p)}
          >
            {p}
          </button>
        ))}
      </div>
      <div className="pm-command">
        <code>{command}</code>
        <CopyButton code={command} />
      </div>
    </div>
  );
}
