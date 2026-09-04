"use client";

import { useEffect, useState } from "react";

interface Progress {
  readonly status: string;
  readonly done: number;
  readonly total: number;
}

// Dev-only navbar pill: polls the progress file the gen-hovers orchestrator maintains
// (public/hover-progress.json, gitignored) and shows the restamp's position while it runs.
// Renders nothing in prod, when no restamp is running, or before the first shard reports.
export function HoverGenProgress() {
  const [progress, setProgress] = useState<Progress | null>(null);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    let alive = true;
    const tick = async (): Promise<void> => {
      try {
        const res = await fetch("/hover-progress.json", { cache: "no-store" });
        if (!res.ok) {
          if (alive) setProgress(null);
          return;
        }
        const json = (await res.json()) as Progress;
        if (alive) setProgress(json);
      } catch {
        if (alive) setProgress(null);
      }
    };
    void tick();
    const id = setInterval(() => void tick(), 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  if (progress === null || progress.status !== "running" || progress.total === 0) return null;
  const pct = Math.min(100, Math.round((progress.done / progress.total) * 100));
  return (
    <div
      className="hovergen-toast"
      role="status"
      title="type-checking dependency sources for the API reference — previews may be stale until this finishes"
    >
      <div className="hovergen-toast-row">
        <span className="hovergen-toast-label">Generating API reference</span>
        <span className="hovergen-toast-count">
          {progress.done}/{progress.total} files
        </span>
      </div>
      <div className="hovergen-toast-track">
        <div className="hovergen-toast-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
