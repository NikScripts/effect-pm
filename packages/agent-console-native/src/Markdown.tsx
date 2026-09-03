/**
 * Message body markdown — `react-native-marked` via `useMarkdown` so we can
 * render into the chat FlatList without nesting another list. HTML passthrough
 * is off (marked treats HTML as plain text). Code is monospaced, not Shiki —
 * same scoped cut as ToolCallBubble's dropped highlighting.
 *
 * @internal
 */
import * as React from "react";
import { Fragment, useColorScheme, StyleSheet, View } from "react-native";
import { useMarkdown, type MarkedStyles } from "react-native-marked";
import { colors } from "./colors";

const MARKDOWN_STYLES: MarkedStyles = {
  text: {
    color: colors.label,
    fontSize: 16,
    lineHeight: 22,
  },
  paragraph: {
    marginTop: 0,
    marginBottom: 8,
  },
  strong: {
    color: colors.label,
    fontWeight: "600",
  },
  em: {
    color: colors.label,
    fontStyle: "italic",
  },
  link: {
    color: colors.tint,
  },
  h1: {
    color: colors.label,
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 8,
    marginTop: 4,
  },
  h2: {
    color: colors.label,
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 6,
    marginTop: 4,
  },
  h3: {
    color: colors.label,
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 4,
    marginTop: 2,
  },
  h4: {
    color: colors.label,
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 4,
  },
  h5: {
    color: colors.label,
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 2,
  },
  h6: {
    color: colors.secondaryLabel,
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 2,
  },
  codespan: {
    color: colors.label,
    fontFamily: "Menlo",
    fontSize: 14,
    backgroundColor: colors.fillBackground,
  },
  code: {
    backgroundColor: colors.fillBackground,
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  blockquote: {
    borderLeftWidth: 3,
    borderLeftColor: colors.separator,
    paddingLeft: 10,
    marginBottom: 8,
  },
  list: {
    marginBottom: 8,
  },
  li: {
    color: colors.label,
    fontSize: 16,
    lineHeight: 22,
  },
  hr: {
    backgroundColor: colors.separator,
    height: StyleSheet.hairlineWidth,
    marginVertical: 12,
  },
  table: {
    borderColor: colors.separator,
    marginBottom: 8,
  },
  tableRow: {
    borderColor: colors.separator,
  },
  tableCell: {
    borderColor: colors.separator,
  },
};

export const Markdown = (props: { readonly text: string }): React.ReactElement => {
  const colorScheme = useColorScheme();
  const elements = useMarkdown(props.text, {
    colorScheme: colorScheme ?? "light",
    styles: MARKDOWN_STYLES,
  });

  return (
    <View style={styles.root}>
      {elements.filter(Boolean).map((element, index) => (
        <Fragment key={`md-${index}`}>{element}</Fragment>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flexShrink: 1,
  },
});
