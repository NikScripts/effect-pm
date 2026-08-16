"use client";

/**
 * Live render of `docs/last/site` ViewDemo — same SSOT as Twoslash on /docs/rsc-router.
 */
import * as React from "react";
import "../styles/widgets.css";
import "../styles/last-site-view-demo.css";
import * as ViewDemo from "../../../../docs/last/site/src/islands/ViewDemo.tsx";

export function LastSiteViewIsland(): React.ReactElement {
  return (
    <div className="hl-dashboard grid gap-3 p-4 rounded-xl text-sm">
      <div className="flex items-center justify-between border-b border-border pb-2">
        <span className="font-medium text-card-foreground">
          docs/last/site · View.make + Last.provide
        </span>
        <span className="text-xs text-muted-foreground">live · product site</span>
      </div>
      <ViewDemo.ViewDemo />
    </div>
  );
}
