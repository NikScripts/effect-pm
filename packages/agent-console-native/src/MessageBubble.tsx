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
import { ROW_GUTTER } from "./layout";
import { Markdown } from "./Markdown";
import { MessageActions } from "./MessageActions";
import { ReasoningBlock } from "./ReasoningBlock";
import { ToolCallBubble } from "./ToolCallBubble";
import type { TranscriptMessage } from "./useSessionStream";

const MessageBubbleImpl = (props: { readonly message: TranscriptMessage }): React.ReactElement => {
  const isUser = props.message.role === "user";
  return (
    <View style={[styles.row, isUser && styles.rowUser]}>
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
        {Array.from(props.message.parts.values()).map((part) => {
          switch (part.type) {
            case "text":
              return <Markdown key={part.id} text={part.text} />;
            case "reasoning":
              return <ReasoningBlock key={part.id} part={part} />;
            default:
              return <ToolCallBubble key={part.id} part={part} />;
          }
        })}
        {/* Assistant only: there is nothing to copy back out of your own
          * message, and a row of controls under every sent line is noise. */}
        {isUser ? null : <MessageActions message={props.message} />}
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
    paddingHorizontal: ROW_GUTTER,
  },
  rowUser: {
    justifyContent: "flex-end",
  },
  bubble: {},
  bubbleAssistant: {
    // Full width: assistant replies are prose, code and tool output, and the
    // right-hand gutter a chat bubble normally reserves just wraps them
    // earlier for no benefit.
    flex: 1,
  },
  bubbleUser: {
    // Still inset — a sent message reads as a bubble, and the asymmetry is
    // what distinguishes the two sides now that replies run edge to edge.
    maxWidth: "88%",
    backgroundColor: colors.brandTint,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
});
