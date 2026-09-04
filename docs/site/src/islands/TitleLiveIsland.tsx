"use client";

/**
 * Live SubscriptionRef title demo (child → parent).
 */
import * as React from "react";
import { App } from "../../../../examples/apps/title-live/app.tsx";
import "./title-live.css";

export function TitleLiveIsland(): React.ReactElement {
  return (
    <div className="last-title-live">
      <div className="last-title-live-chrome">
        <span className="last-title-live-label">SubscriptionRef · child → parent</span>
        <span className="last-title-live-meta">live</span>
      </div>
      <App />
    </div>
  );
}
