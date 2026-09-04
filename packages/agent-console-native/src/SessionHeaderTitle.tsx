/**
 * The chat session's header title — the app's standard glass title pill (see
 * HeaderTitlePill) plus a live connection dot. `connected` comes from
 * `useSessionStream`'s `/global/event` reconnect loop — real state, not a
 * synthesized always-on badge.
 *
 * @internal
 */
import * as React from "react";
import { HeaderTitlePill } from "./HeaderTitlePill";

export const SessionHeaderTitle = (props: {
  readonly title: string | undefined;
  readonly connected: boolean;
}): React.ReactElement => <HeaderTitlePill title={props.title ?? "Session"} dot={props.connected ? "connected" : "disconnected"} />;
