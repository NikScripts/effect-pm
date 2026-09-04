/**
 * Renders one tool call inline in the transcript — read/edit/write/glob/grep/
 * etc. `ToolPart.input`/`.output` are loosely typed by the SDK, so this reads
 * defensively rather than assuming a schema. Ported from
 * packages/agent-console/src/components/ToolCallBubble.tsx, minus syntax
 * highlighting — that version's Shiki + `dangerouslySetInnerHTML` is a DOM
 * mechanism with no native equivalent short of a WebView; output renders as
 * plain monospace text here (a real, scoped v1 cut, not a placeholder).
 *
 * Open/closed comes from `useCollapsible`: the transcript auto-expands only
 * its newest collapsible, so a finished call folds away when the next one
 * starts. Tap the header to pin it either way.
 *
 * @internal
 */
import * as React from "react";
import type { ToolPart } from "@opencode-ai/sdk";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { colors } from "./colors";
import { asHtmlPayload, HtmlToolBlock } from "./HtmlToolBlock";
import { useCollapsible } from "./CollapsibleParts";
import { SystemIcon } from "./SystemIcon";

const EDIT_FAMILY = new Set(["edit", "write", "patch"]);
/** Same timings as ReasoningBlock, so the two read as one system. */
const COLLAPSE_MS = 180;
const EXIT_MS = 120;

const filePathOf = (input: Record<string, unknown>): string | undefined => {
  for (const key of ["filePath", "file_path", "path"]) {
    const value = input[key];
    if (typeof value === "string") return value;
  }
  return undefined;
};

export const ToolCallBubble = (props: { readonly part: ToolPart }): React.ReactElement => {
  const { part } = props;
  const path = filePathOf(part.state.input);
  const isEditFamily = EDIT_FAMILY.has(part.tool);
  const lineCount = part.state.status === "completed" ? part.state.output.split("\n").length : 0;
  const { open, toggle } = useCollapsible(part.id);

  // `render_html` returns a page, not text. Its own output string is a short
  // summary meant for the model's next turn — showing it here instead of the
  // page would be strictly worse than useless.
  const htmlPayload =
    part.tool === "render_html" && part.state.status === "completed"
      ? asHtmlPayload(part.state.metadata)
      : undefined;

  const body = (() => {
    if (htmlPayload !== undefined) return <HtmlToolBlock payload={htmlPayload} />;
    switch (part.state.status) {
      case "pending":
        return null;
      case "running":
        return <Text style={styles.status}>running…</Text>;
      case "completed":
        return (
          <Text style={styles.output} selectable>
            {part.state.output}
          </Text>
        );
      case "error":
        return (
          <Text style={[styles.output, styles.errorOutput]} selectable>
            {part.state.error}
          </Text>
        );
    }
  })();

  return (
    <Animated.View style={styles.root} layout={LinearTransition.duration(COLLAPSE_MS)}>
      <TouchableOpacity style={styles.header} activeOpacity={0.6} onPress={toggle}>
        <Text style={styles.toolName}>{part.tool}</Text>
        {path !== undefined ? (
          <Text style={styles.path} numberOfLines={1}>
            {path}
          </Text>
        ) : null}
        {part.state.status === "completed" && !isEditFamily ? <Text style={styles.meta}>{lineCount} lines</Text> : null}
        <SystemIcon name={open ? "chevron.up" : "chevron.down"} size={12} color={colors.secondaryLabel} />
      </TouchableOpacity>
      {open ? (
        <Animated.View entering={FadeIn.duration(COLLAPSE_MS)} exiting={FadeOut.duration(EXIT_MS)}>
          {body}
        </Animated.View>
      ) : null}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  root: {
    marginTop: 8,
    borderRadius: 10,
    backgroundColor: colors.fillBackground,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  toolName: {
    color: colors.label,
    fontSize: 13,
    fontWeight: "600",
  },
  path: {
    flex: 1,
    color: colors.secondaryLabel,
    fontSize: 12,
  },
  meta: {
    color: colors.secondaryLabel,
    fontSize: 12,
  },
  status: {
    color: colors.secondaryLabel,
    fontSize: 13,
    paddingHorizontal: 10,
    paddingBottom: 10,
  },
  output: {
    color: colors.label,
    fontSize: 12,
    fontFamily: "Menlo",
    paddingHorizontal: 10,
    paddingBottom: 10,
  },
  errorOutput: {
    color: colors.destructive,
  },
});
