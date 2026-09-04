/**
 * The rendered output of the `render_html` tool.
 *
 * A real WebView, not `react-native-render-html`: that renderer maps tags to
 * native views with no CSS engine and no JavaScript, so anything with a real
 * layout comes out as an approximation. This is the path for when the page
 * should look like the page.
 *
 * Sandboxed on purpose — the markup is written by an agent:
 *
 * - Content is loaded as a string, so the document's origin is `about:blank`
 *   rather than anything with access to a real origin's storage or cookies.
 *   Note this also means relative `src`/`href` in a rendered *file* will not
 *   resolve; self-contained documents are the supported case.
 * - Navigation is refused. Tapping a link cannot silently take the view
 *   somewhere remote; the URL is surfaced for the reader to open deliberately.
 * - Scripts are off unless the tool call explicitly asked for them.
 *
 * @internal
 */
import * as React from "react";
import { Linking, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { WebView } from "react-native-webview";
import { colors } from "./colors";
import { SystemIcon } from "./SystemIcon";

/** Collapsed height. Pages are their own thing inside a chat — full height
 * would swallow the transcript. */
const PREVIEW_HEIGHT = 260;
const EXPANDED_HEIGHT = 560;

export type HtmlPayload = {
  readonly html: string;
  readonly title?: string;
  readonly path?: string;
  readonly allowScripts: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** Reads the tool's metadata defensively — it crosses a server boundary and
 * is typed as an open record, so nothing here can be assumed. */
export const asHtmlPayload = (metadata: unknown): HtmlPayload | undefined => {
  if (!isRecord(metadata) || metadata.kind !== "html") return undefined;
  if (typeof metadata.html !== "string" || metadata.html === "") return undefined;
  return {
    html: metadata.html,
    title: typeof metadata.title === "string" ? metadata.title : undefined,
    path: typeof metadata.path === "string" ? metadata.path : undefined,
    allowScripts: metadata.allowScripts === true,
  };
};

export const HtmlToolBlock = (props: { readonly payload: HtmlPayload }): React.ReactElement => {
  const { payload } = props;
  const [expanded, setExpanded] = React.useState(false);
  const [blockedUrl, setBlockedUrl] = React.useState<string | undefined>(undefined);

  return (
    <View style={styles.root}>
      <TouchableOpacity style={styles.header} activeOpacity={0.6} onPress={() => setExpanded((open) => !open)}>
        <SystemIcon name="safari" size={13} color={colors.secondaryLabel} />
        <Text style={styles.title} numberOfLines={1}>
          {payload.title ?? payload.path ?? "Rendered HTML"}
        </Text>
        {payload.allowScripts ? <Text style={styles.badge}>JS</Text> : null}
        <SystemIcon name={expanded ? "chevron.up" : "chevron.down"} size={12} color={colors.secondaryLabel} />
      </TouchableOpacity>

      <WebView
        style={[styles.web, { height: expanded ? EXPANDED_HEIGHT : PREVIEW_HEIGHT }]}
        originWhitelist={["about:*"]}
        source={{ html: payload.html }}
        javaScriptEnabled={payload.allowScripts}
        // Everything except the initial in-memory document is refused, so a
        // link cannot navigate this view off to a remote page.
        onShouldStartLoadWithRequest={(request) => {
          if (request.url.startsWith("about:")) return true;
          setBlockedUrl(request.url);
          return false;
        }}
        scrollEnabled
        nestedScrollEnabled
      />

      {blockedUrl === undefined ? null : (
        <TouchableOpacity
          style={styles.blocked}
          activeOpacity={0.6}
          onPress={() => {
            void Linking.openURL(blockedUrl);
          }}
        >
          <Text style={styles.blockedText} numberOfLines={1}>
            Open {blockedUrl} in Safari
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    marginTop: 8,
    borderRadius: 12,
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
  title: {
    flex: 1,
    color: colors.label,
    fontSize: 13,
    fontWeight: "600",
  },
  badge: {
    color: colors.secondaryLabel,
    fontSize: 10,
    fontWeight: "700",
  },
  web: {
    backgroundColor: "#FFFFFF",
  },
  blocked: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  blockedText: {
    color: colors.tint,
    fontSize: 12,
  },
});
