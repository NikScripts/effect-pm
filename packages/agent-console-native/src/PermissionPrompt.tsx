/**
 * A permission request, rendered as a message in the transcript.
 *
 * It is a real item in the list rather than a header or an overlay: the
 * request happened at a point in the conversation, and it belongs there in
 * order, scrolling with everything else.
 *
 * Glass rather than a flat card so it reads as a live thing the run is
 * waiting on, distinct from the assistant's own plain text. `GlassView` is
 * used the same way the composer uses it — a single instance for the
 * element's lifetime, never remounted (see Composer.tsx for why that
 * matters).
 *
 * @internal
 */
import { GlassView } from "expo-glass-effect";
import * as React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { colors } from "./colors";
import { ROW_GUTTER } from "./layout";
import { SystemIcon } from "./SystemIcon";
import type { PendingPermission, PermissionReply } from "./sessionPermissions";

export const PermissionPrompt = (props: {
  readonly pending: PendingPermission;
  readonly onReply: (reply: PermissionReply) => void;
}): React.ReactElement => {
  const { pending } = props;
  const detail = pending.resources.length > 0 ? pending.resources.join("\n") : undefined;

  return (
    <View style={styles.row}>
      <GlassView style={styles.bubble} glassEffectStyle="regular">
        <View style={styles.headerRow}>
          <SystemIcon name="lock.shield" size={15} color={colors.tint} />
          <Text style={styles.title}>Permission needed</Text>
        </View>

        <Text style={styles.action}>{pending.action}</Text>
        {detail === undefined ? null : (
          <Text style={styles.detail} numberOfLines={6}>
            {detail}
          </Text>
        )}

        <View style={styles.actions}>
          <TouchableOpacity style={styles.button} activeOpacity={0.6} onPress={() => props.onReply("reject")}>
            <Text style={[styles.buttonLabel, styles.denyLabel]}>Deny</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.approve]}
            activeOpacity={0.6}
            onPress={() => props.onReply("once")}
          >
            <Text style={[styles.buttonLabel, styles.approveLabel]}>Approve</Text>
          </TouchableOpacity>
        </View>
      </GlassView>
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    marginBottom: 14,
    paddingHorizontal: ROW_GUTTER,
  },
  bubble: {
    flex: 1,
    borderRadius: 18,
    padding: 14,
    gap: 8,
    overflow: "hidden",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  title: {
    color: colors.secondaryLabel,
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  action: {
    color: colors.label,
    fontSize: 15,
    fontWeight: "600",
  },
  detail: {
    color: colors.secondaryLabel,
    fontSize: 13,
    fontFamily: "Menlo",
    lineHeight: 18,
  },
  actions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
  },
  button: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.fillBackground,
  },
  buttonLabel: {
    fontSize: 15,
    fontWeight: "600",
  },
  denyLabel: {
    color: colors.destructive,
  },
  approve: {
    backgroundColor: colors.brandTint,
  },
  approveLabel: {
    color: colors.tint,
  },
});
