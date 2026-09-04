"use client";

// Copy-to-clipboard button for a code block. Server renders the highlighted code; this small
// client island carries the raw source text (the *visible* code, preamble stripped) and copies
// it on click. Sits in the top-right of a `.code-block` container (see docs.css). Shows a
// clipboard icon, swapping to a check on success.

import * as React from "react";

const CopyIcon = (): React.ReactElement => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const CheckIcon = (): React.ReactElement => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

// `navigator.clipboard` only exists in a **secure context** (https or localhost). The docs are
// served over plain http on Tailscale, so it's undefined there — fall back to a hidden-textarea
// `execCommand("copy")`, which works over insecure origins.
const writeClipboard = (text: string): boolean => {
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text).catch(() => execCopy(text));
    return true;
  }
  return execCopy(text);
};
const execCopy = (text: string): boolean => {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = "0";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
};

export function CopyButton({ code }: { readonly code: string }): React.ReactElement {
  const [copied, setCopied] = React.useState(false);
  const onCopy = React.useCallback(() => {
    if (writeClipboard(code)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
  }, [code]);
  return (
    <button
      type="button"
      className="copy-btn"
      aria-label={copied ? "Copied" : "Copy code"}
      title={copied ? "Copied" : "Copy"}
      data-copied={copied ? "" : undefined}
      onClick={onCopy}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}
