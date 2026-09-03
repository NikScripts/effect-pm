/**
 * User = right-aligned tinted bubble; assistant = plain left-aligned text,
 * no bubble — the pattern ChatGPT/Claude's own clients use, not a dev-tool
 * log. Ported from packages/agent-console/src/components/MessageBubble.tsx,
 * with markdown via `Markdown.tsx` (no Shiki — monospaced fences only).
 *
 * Memoized for the same reason as the web version: `useSessionStream`'s
 * updater only creates a new `TranscriptMessage` object for the message an
 * incoming event actually touched, so this skips re-rendering every other
 * bubble during a streaming response.
 *
 * @internal
 */
import * as React from "react";
import { StyleSheet, View } from "react-native";
import { colors } from "./colors";
import { Markdown } from "./Markdown";
import { ToolCallBubble } from "./ToolCallBubble";
import type { TranscriptMessage } from "./useSessionStream";

const MessageBubbleImpl = (props: { readonly message: TranscriptMessage }): React.ReactElement => {
  const isUser = props.message.role === "user";
  return (
    <View style={[styles.row, isUser && styles.rowUser]}>
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
        {Array.from(props.message.parts.values()).map((part) =>
          part.type === "text" ? (
            <Markdown key={part.id} text={part.text} />
          ) : (
            <ToolCallBubble key={part.id} part={part} />
          ),
        )}
      </View>
    </View>
  );
};
MessageBubbleImpl.displayName = "MessageBubble";

export const MessageBubble = React.memo(MessageBubbleImpl);

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    marginBottom: 14,
  },
  rowUser: {
    justifyContent: "flex-end",
  },
  bubble: {
    maxWidth: "88%",
  },
  bubbleAssistant: {
    flex: 1,
  },
  bubbleUser: {
    backgroundColor: colors.brandTint,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
});
