/**
 * What's shown while the agent is working: the typing dots, how long it has
 * been going, and a way out.
 *
 * The elapsed clock is not decoration. opencode publishes each message part
 * exactly twice — once empty when it is created, once complete — with no
 * deltas in between, so a long reasoning phase is a genuine multi-minute gap
 * where nothing at all arrives. Measured on this server: a reasoning part sat
 * empty for 62 seconds before landing in full. Without a running clock that is
 * indistinguishable from a hang.
 *
 * @internal
 */
import * as React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { colors } from "./colors";
import { ROW_GUTTER } from "./layout";
import { SystemIcon } from "./SystemIcon";
import { TypingIndicator } from "./TypingIndicator";

const TICK_MS = 1000;

const elapsedLabel = (sinceMs: number): string => {
  const total = Math.max(0, Math.floor((Date.now() - sinceMs) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};

export const BusyRow = (props: {
  readonly onStop: () => void;
  /** When the run began, from the server's own timestamp. Falls back to mount
   * time only if the server has not reported one yet — capturing it at mount
   * restarted the clock every time the chat was reopened. */
  readonly startedAt?: number;
}): React.ReactElement => {
  const mountedAt = React.useRef(Date.now()).current;
  const startedAt = props.startedAt ?? mountedAt;
  const [, forceTick] = React.useReducer((n: number) => n + 1, 0);

  React.useEffect(() => {
    const timer = setInterval(forceTick, TICK_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <View style={styles.root}>
      <TypingIndicator />
      <Text style={styles.elapsed}>{elapsedLabel(startedAt)}</Text>
      <View style={styles.spacer} />
      <TouchableOpacity style={styles.stop} activeOpacity={0.6} onPress={props.onStop} accessibilityLabel="Stop the agent">
        <SystemIcon name="stop.fill" size={11} color={colors.destructive} />
        <Text style={styles.stopLabel}>Stop</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
    paddingHorizontal: ROW_GUTTER,
  },
  elapsed: {
    color: colors.secondaryLabel,
    fontSize: 12,
    fontVariant: ["tabular-nums"],
  },
  spacer: {
    flex: 1,
  },
  stop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: colors.fillBackground,
  },
  stopLabel: {
    color: colors.destructive,
    fontSize: 13,
    fontWeight: "600",
  },
});
