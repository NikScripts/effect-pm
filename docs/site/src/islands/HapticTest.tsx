"use client";

// A diagnostic button: tapping it fires a haptic directly (inside the click gesture), so it isolates
// whether haptics work on this device at all — independent of the long-press-to-copy path. Shows
// whether web-haptics reports support.

import * as React from "react";
import { WebHaptics } from "web-haptics";

export function HapticTest(): React.ReactElement {
  const ref = React.useRef<WebHaptics | null>(null);
  const [note, setNote] = React.useState("");
  React.useEffect(() => {
    ref.current = new WebHaptics();
    return () => ref.current?.destroy();
  }, []);
  return (
    <button
      type="button"
      className="haptic-test"
      onClick={() => {
        void ref.current?.trigger("success").catch(() => {});
        setNote(WebHaptics.isSupported ? "buzzed" : "no haptics on this device");
      }}
    >
      Test haptic{note ? ` — ${note}` : ""}
    </button>
  );
}
