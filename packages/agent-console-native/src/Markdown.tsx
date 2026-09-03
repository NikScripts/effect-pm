/**
 * Message body markdown — `react-native-marked` via `useMarkdown` so we can
 * render into the chat FlatList without nesting another list. HTML tokens and
 * mostly-HTML payloads go through `react-native-render-html`. Code is
 * monospaced, not Shiki — same scoped cut as ToolCallBubble's dropped
 * highlighting.
 *
 * @internal
 */
import * as React from "react";
import type { ReactNode } from "react";
import {
  StyleSheet,
  Text,
  useColorScheme,
  useWindowDimensions,
  View,
  type TextStyle,
} from "react-native";
import {
  Renderer,
  useMarkdown,
  type MarkedStyles,
  type RendererInterface,
} from "react-native-marked";
import RenderHTML from "react-native-render-html";
import { colors } from "./colors";

const HTML_TAG_RE = /<\/?[a-z][\s\S]*>/i;

function isMostlyHtml(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed.startsWith("<")) return false;
  return HTML_TAG_RE.test(trimmed);
}

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

const htmlTagsStyles = {
  a: { color: colors.tint },
  code: {
    fontFamily: "Menlo",
    backgroundColor: colors.fillBackground,
  },
  pre: {
    fontFamily: "Menlo",
    backgroundColor: colors.fillBackground,
  },
};

class HtmlAwareRenderer extends Renderer implements RendererInterface {
  #contentWidth: number;

  constructor(contentWidth: number) {
    super();
    this.#contentWidth = contentWidth;
  }

  override html(text: string | ReactNode[], styles?: TextStyle): ReactNode {
    if (typeof text !== "string") {
      return super.html(text, styles);
    }
    const html = text.trim();
    if (!html || !HTML_TAG_RE.test(html)) {
      return (
        <Text key={this.getKey()} style={styles}>
          {text}
        </Text>
      );
    }
    return (
      <RenderHTML
        key={this.getKey()}
        contentWidth={this.#contentWidth}
        source={{ html }}
        baseStyle={{
          color: colors.label,
          fontSize: 16,
          lineHeight: 22,
        }}
        tagsStyles={htmlTagsStyles}
      />
    );
  }
}

export const Markdown = (props: { readonly text: string }): React.ReactElement => {
  const colorScheme = useColorScheme();
  const { width: windowWidth } = useWindowDimensions();
  const contentWidth = Math.max(120, Math.min(windowWidth - 80, 560));

  const renderer = React.useMemo(
    () => new HtmlAwareRenderer(contentWidth),
    [contentWidth],
  );

  const elements = useMarkdown(props.text, {
    colorScheme: colorScheme ?? "light",
    styles: MARKDOWN_STYLES,
    renderer,
  });

  if (!props.text.trim()) {
    return <View style={styles.root} />;
  }

  if (isMostlyHtml(props.text)) {
    return (
      <View style={styles.root}>
        <RenderHTML
          contentWidth={contentWidth}
          source={{ html: props.text.trim() }}
          baseStyle={{
            color: colors.label,
            fontSize: 16,
            lineHeight: 22,
          }}
          tagsStyles={htmlTagsStyles}
        />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {elements.filter(Boolean).map((element, index) => (
        <React.Fragment key={`md-${index}`}>{element}</React.Fragment>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flexShrink: 1,
  },
});
