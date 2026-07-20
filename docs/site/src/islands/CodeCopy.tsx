"use client";

// Copy buttons for code blocks the server DOESN'T wrap in .code-block (API signature/source
// blocks) — guide blocks already render CopyButton server-side. This island portals the SAME
// CopyButton component into every uncovered <pre>, so look and clipboard behavior can't drift.
// A MutationObserver keeps client-side navigations covered; portal insertions re-fire it but
// the seen-set makes rescans no-ops.

import * as React from "react";
import { createPortal } from "react-dom";
import { CopyButton } from "./CopyButton.js";

interface Target {
  readonly key: number;
  readonly el: HTMLElement;
  readonly code: string;
}

// the code only: strip inert popup templates and any copy button from the reading
const codeOf = (pre: HTMLElement): string => {
  const clone = pre.cloneNode(true);
  if (!(clone instanceof HTMLElement)) return pre.textContent ?? "";
  clone.querySelectorAll(".twoslash-popups, .copy-btn").forEach((el) => el.remove());
  return (clone.textContent ?? "").replace(/\n$/, "");
};

export function CodeCopy(): React.ReactElement {
  const [targets, setTargets] = React.useState<ReadonlyArray<Target>>([]);

  React.useEffect(() => {
    let nextKey = 0;
    const seen = new WeakSet<Element>();
    const scan = (): void => {
      const found: Array<Target> = [];
      document.querySelectorAll("main pre").forEach((pre) => {
        if (!(pre instanceof HTMLElement) || seen.has(pre)) return;
        // covered elsewhere: server-rendered blocks, install widgets, hover popups
        if (pre.closest(".code-block, .pm-command, .twoslash-popup-container") !== null) return;
        seen.add(pre);
        found.push({
          key: nextKey++,
          el: pre,
          code: codeOf(pre),
        });
      });
      setTargets((current) => {
        const alive = current.filter((t) => t.el.isConnected);
        return found.length > 0 || alive.length !== current.length ? [...alive, ...found] : current;
      });
    };
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, []);

  return <>{targets.map((t) => createPortal(<CopyButton code={t.code} />, t.el, String(t.key)))}</>;
}
