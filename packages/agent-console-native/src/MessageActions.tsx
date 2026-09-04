/**
 * Per-message actions — copy, share.
 *
 * Uses React Native's core `Clipboard` and `Share` rather than
 * `expo-clipboard`: both are already in the installed binary, so this works
 * on a Metro reload instead of costing a native rebuild. Core `Clipboard` is
 * deprecated in favour of the Expo module — worth migrating the next time a
 * rebuild happens for another reason, not worth one on its own.
 *
 * Only the message's prose is copied. Reasoning and tool output are collapsed
 * detail inside the bubble; sweeping them into a copy would produce something
 * nobody meant to paste.
 *
 * @internal
 */
import * as React from "react";
import { Clipboard, Share, StyleSheet, TouchableOpacity, View } from "react-native";
import { colors } from "./colors";
import { SystemIcon } from "./SystemIcon";
import type { TranscriptMessage } from "./useSessionStream";

/** How long the button stays confirming after a copy. */
const COPIED_FEEDBACK_MS = 1400;

export const textOf = (message: TranscriptMessage): string =>
  Array.from(message.parts.values())
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n\n")
    .trim();

export const MessageActions = (props: { readonly message: TranscriptMessage }): React.ReactElement | null => {
  const [copied, setCopied] = React.useState(false);
  const text = textOf(props.message);

  React.useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  // Nothing to act on until some prose exists — a message that is still only
  // tool calls or reasoning has nothing to copy.
  if (text === "") return null;

  return (
    <View style={styles.row}>
      <TouchableOpacity
        style={styles.button}
        activeOpacity={0.6}
        accessibilityLabel="Copy message"
        onPress={() => {
          Clipboard.setString(text);
          setCopied(true);
        }}
      >
        {/* The glyph swap is the whole confirmation — no label to read. */}
        <SystemIcon
          name={copied ? "checkmark" : "doc.on.doc"}
          size={15}
          color={copied ? colors.brand : colors.secondaryLabel}
        />
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.button}
        activeOpacity={0.6}
        accessibilityLabel="Share message"
        onPress={() => {
          void Share.share({ message: text });
        }}
      >
        <SystemIcon name="square.and.arrow.up" size={15} color={colors.secondaryLabel} />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "flex-end",
    // Markdown's last paragraph carries `marginBottom: 8` (Markdown.tsx),
    // which stacked on top of the buttons' own padding. Pulled back so the
    // row sits just under the text instead of a line away from it.
    marginTop: -8,
  },
  button: {
    // Padding does the work a label used to: keeps the tap target usable
    // once the text is gone. It is inside the button, so it adds no spacing
    // around the row itself.
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
});
