"use client";

/**
 * Live RouterBuilder demo — Effect home + JSX about under Memory + Outlet.
 */
import * as React from "react";
import "../styles/widgets.css";
import * as Page from "last-ts/Page";
import { DemoProvider, Router, StampedAbout } from "./router-page-demo.js";

function DemoChrome(): React.ReactElement {
  const router = Router.useRouter();
  const atAbout = router.pathname === "/about";
  const stamp = Page.stampOf(StampedAbout);
  return (
    <div className="hl-dashboard grid gap-3 p-4 rounded-xl text-sm">
      <div className="flex items-center justify-between border-b border-border pb-2 gap-2">
        <span className="font-medium text-card-foreground">
          RouterBuilder + Page
        </span>
        <div className="flex gap-1">
          <button
            type="button"
            className={
              !atAbout
                ? "text-xs px-2 py-1 rounded bg-muted text-card-foreground"
                : "text-xs px-2 py-1 rounded text-muted-foreground"
            }
            onClick={() => {
              router.go("/");
            }}
          >
            Effect home
          </button>
          <button
            type="button"
            className={
              atAbout
                ? "text-xs px-2 py-1 rounded bg-muted text-card-foreground"
                : "text-xs px-2 py-1 rounded text-muted-foreground"
            }
            onClick={() => {
              router.go("/about");
            }}
          >
            JSX about
          </button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {stamp !== undefined
          ? `Page.static("${stamp.path}", …, { title: "${stamp.title}" })`
          : "Page.static stamp missing"}
      </p>
      <Router.Outlet />
    </div>
  );
}

export function RouterPageIsland(): React.ReactElement {
  return (
    <DemoProvider>
      <DemoChrome />
    </DemoProvider>
  );
}
