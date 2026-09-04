// The right column of a doc page: a migration DRAFT note (badge + checklist) over the on-this-page
// TOC. On phones the aside is hidden and the draft note becomes a collapsible banner at the top of the
// page (DraftBanner). Both are static server-rendered (native <details>, anchor links — no client JS).

import * as React from "react";
import type { ChapterMeta } from "../lib/standards-manifest.js";
import type { TocEntry } from "../lib/docs-content.js";

// The migration gates a legacy/draft page clears to become canonical. Keys match a page block's
// `done="…"`. Keep in sync with the checklist convention in docs/standards.
const CHECKLIST: ReadonlyArray<{ readonly key: string; readonly label: string }> = [
  { key: "api", label: "Current API — no legacy surface" },
  { key: "previews", label: "LSP code previews" },
  { key: "types", label: "Clean example types" },
  { key: "verified", label: "Verified examples" },
  { key: "standards", label: "Follows the docs standards" },
  { key: "reviewed", label: "Owner-reviewed" },
];

const DraftBadge = (): React.ReactElement => <span className="draft-badge">Draft</span>;

function DraftChecklist({ done }: { readonly done: ReadonlyArray<string> }): React.ReactElement {
  return (
    <ul className="draft-check">
      {CHECKLIST.map((item) => {
        const ok = done.includes(item.key);
        return (
          <li key={item.key} className="draft-check-item" data-done={ok ? "" : undefined}>
            <span className="draft-check-box" aria-hidden="true">{ok ? "✓" : ""}</span>
            <span>{item.label}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Collapsible draft banner — shown on phones (the aside is hidden there). */
export function DraftBanner({ meta }: { readonly meta: ChapterMeta }): React.ReactElement | null {
  if (meta.status !== "draft") return null;
  const done = meta.done ?? [];
  return (
    <details className="draft-banner">
      <summary>
        <DraftBadge />
        <span className="draft-banner-label">Migration checklist — {done.length}/{CHECKLIST.length}</span>
      </summary>
      <DraftChecklist done={done} />
    </details>
  );
}

/** Right column on wide screens: draft note (if any) over the on-this-page TOC. */
export function PageAside({
  meta,
  toc,
}: {
  readonly meta: ChapterMeta;
  readonly toc: ReadonlyArray<TocEntry>;
}): React.ReactElement | null {
  const draft = meta.status === "draft";
  if (!draft && toc.length === 0) return null;
  return (
    <aside className="page-aside">
      {draft && (
        <div className="draft-note">
          <div className="draft-note-head">
            <DraftBadge />
            <span>Migration checklist</span>
          </div>
          <DraftChecklist done={meta.done ?? []} />
        </div>
      )}
      {toc.length > 0 && (
        <nav className="toc" aria-label="On this page">
          <p className="toc-title">On this page</p>
          <ul>
            {toc.map((e) => (
              <li key={e.id} className={e.level === 3 ? "toc-sub" : undefined}>
                <a href={`#${e.id}`}>{e.text}</a>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </aside>
  );
}
