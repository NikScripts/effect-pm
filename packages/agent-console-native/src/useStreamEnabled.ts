/**
 * Whether a session stream should be connected right now.
 *
 * True only while the chat screen is the focused route AND the app is in the
 * foreground. Navigating back or backgrounding the app drops the SSE
 * connection; returning re-establishes it, and `useSessionStream` reloads
 * history on reconnect, so nothing missed while disconnected is lost.
 *
 * A long-lived SSE connection from a backgrounded phone is not free: iOS
 * suspends the socket without closing it cleanly, so the server keeps a dead
 * subscriber and the client sits on a connection that will never deliver.
 * Reconnecting on return is both cheaper and more correct than pretending the
 * connection survived.
 *
 * @internal
 */
import { useIsFocused } from "@react-navigation/native";
import * as React from "react";
import { AppState, type AppStateStatus } from "react-native";

export const useStreamEnabled = (): boolean => {
  const isFocused = useIsFocused();
  const [isActive, setIsActive] = React.useState(() => AppState.currentState === "active");

  React.useEffect(() => {
    const subscription = AppState.addEventListener("change", (next: AppStateStatus) => {
      setIsActive(next === "active");
    });
    return () => subscription.remove();
  }, []);

  return isFocused && isActive;
};
