/**
 * A session's chat transcript — ported from
 * packages/agent-console/src/pages/SessionChat.tsx.
 *
 * The header is the real UINavigationBar (see RootNavigator), transparent
 * and empty apart from the system back button, a title set from this
 * screen's own state, and a native "more" item. It exists so iOS 26's
 * scroll edge effect has a bar to anchor to — that blur only renders where
 * scrolling content meets a bar. An earlier version floated custom glass
 * pieces over the screen with the header hidden, which meant no blur was
 * possible at all.
 *
 * @internal
 */
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as React from "react";
import { FlatList, Platform, StyleSheet, Text, Vibration, View } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollViewMarker } from "react-native-screens/src/components/gamma/scroll-view-marker";
import { VariableBlur } from "../modules/variable-blur";
import { useAppContext } from "./AppContext";
import { AGENT } from "./client";
import { colors } from "./colors";
import { MessageBubble } from "./MessageBubble";
import type { RootStackParamList } from "./RootNavigator";
import { Composer } from "./Composer";
import { SessionHeaderTitle } from "./SessionHeaderTitle";
import { TypingIndicator } from "./TypingIndicator";
import { useKeyboardHeight } from "./useKeyboardHeight";
import { useSessionStream } from "./useSessionStream";
import { DynamicColorIOS } from "react-native";

type Props = NativeStackScreenProps<RootStackParamList, "Chat">;

const TOP_BLUR_RADIUS = 5;
const BOTTOM_BLUR_RADIUS = 3;
const TOP_BLUR_HEIGHT = 140;
const BOTTOM_BLUR_HEIGHT = 80;

/** Same ramp shape as the blur mask — solid at the screen edge, clear inward.
 * Lightens as it blurs so the chrome reads soft rather than muddy. */
const EDGE_LIGHT_STOPS = [
  DynamicColorIOS({ light: "rgba(255,255,255,0.55)", dark: "rgba(0,0,0,0.5)" }),
  DynamicColorIOS({ light: "rgba(255,255,255,0.28)", dark: "rgba(0,0,0,0.26)" }),
  DynamicColorIOS({ light: "rgba(255,255,255,0.1)", dark: "rgba(0,0,0,0.1)" }),
  "transparent",
] as const;
const EDGE_LIGHT_LOCATIONS = [0, 0.35, 0.7, 1] as const;

export const SessionChatScreen = (props: Props): React.ReactElement => {
  const { client } = useAppContext();
  const sessionID = props.route.params.sessionID;
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  // Transparent header, so content sits under it and pads itself by the
  // header's real height. On this inverted list that padding is
  // `paddingBottom` — see the contentContainerStyle note below.
  const topBarHeight = useHeaderHeight();
  const { transcript, markBusy, clearBusy, sendOptimistic, connected } = useSessionStream(client, sessionID);
  const [title, setTitle] = React.useState<string | undefined>(undefined);
  // Newest-first — paired with `inverted` below, which should anchor the
  // list to the newest message on its own. In practice it wasn't sticking
  // reliably, so this still explicitly re-pins to `offset: 0` (an
  // inverted list's "start", i.e. its bottom) whenever a message is
  // appended — the same role the old `scrollToEnd` played pre-inversion.
  const reversedOrder = React.useMemo(() => [...transcript.order].reverse(), [transcript.order]);
  const listRef = React.useRef<FlatList<string>>(null);
  // The composer floats over the list (see its absolute wrapper below) so
  // the glass actually has content passing behind it — which means the
  // list has to reserve that space itself instead of getting it from flex
  // layout. Measured rather than hardcoded because the composer grows
  // with multi-line input; onLayout re-fires on every one of those height
  // changes, so the reserved space tracks it.
  const [composerHeight, setComposerHeight] = React.useState(0);

  React.useEffect(() => {
    if (reversedOrder.length > 0) listRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, [reversedOrder.length]);

  // Buzz when the agent finishes replying, not on every streamed part —
  // parts arrive continuously while it types, which would vibrate
  // nonstop. `busy` going true -> false is the completion signal, and the
  // same one the closed-app notification will use.
  const wasBusy = React.useRef(false);
  React.useEffect(() => {
    if (wasBusy.current && !transcript.busy) {
      Vibration.vibrate();
    }
    wasBusy.current = transcript.busy;
  }, [transcript.busy]);

  // Title and connection state are screen state, so they reach the header
  // through setOptions rather than static screen options.
  React.useEffect(() => {
    props.navigation.setOptions({
      headerTitle: () => <SessionHeaderTitle title={title ?? sessionID} connected={connected} />,
      unstable_headerRightItems: () => [
        { type: "button", label: "More", icon: { type: "sfSymbol", name: "ellipsis" }, onPress: () => {} },
      ],
    });
  }, [props.navigation, title, sessionID, connected]);

  React.useEffect(() => {
    setTitle(undefined);
    client.session
      .get({ path: { id: sessionID } })
      .then(({ data }) => setTitle(data?.title))
      .catch(() => {
        // Non-critical — the header just shows the raw id as a fallback.
      });
  }, [client, sessionID]);

  const onSend = async (text: string): Promise<void> => {
    sendOptimistic(text);
    markBusy();
    try {
      await client.session.promptAsync({
        path: { id: sessionID },
        body: { agent: AGENT, parts: [{ type: "text", text }] },
      });
    } catch (err) {
      clearBusy();
      throw err;
    }
  };

  // No `paddingBottom: keyboardHeight` on root — the composer is
  // absolutely positioned, and absolute children weren't being offset by
  // that padding (they sat behind the keyboard instead), so both the
  // composer and the list account for the keyboard explicitly below
  // rather than relying on padding-box positioning semantics.
  return (
    <View style={styles.root}>
      {/* Marks this list for iOS 26's scroll edge effect. Both edges are
        * set because the list is `inverted` (a scaleY(-1) transform), so
        * its native top edge is the visual bottom — targeting one edge
        * would mean guessing at that mapping. */}
      <ScrollViewMarker style={styles.flex} scrollEdgeEffects={{ top: "soft", bottom: "soft" }}>
      <FlatList
        ref={listRef}
        inverted
        // Scroll edge effects need automatic inset adjustment against the
        // transparent header — without this the soft edge often never renders.
        contentInsetAdjustmentBehavior="automatic"
        style={styles.flex}
        data={reversedOrder}
        keyExtractor={(id) => id}
        renderItem={({ item }) => {
          const message = transcript.messages.get(item);
          return message === undefined ? null : <MessageBubble message={message} />;
        }}
        ListEmptyComponent={<Text style={styles.empty}>Ask a question, or ask it to make a change.</Text>}
        // Below the newest message, not above the oldest — the header, not
        // the footer, is what renders nearest the (inverted) start of the
        // list, which an inverted list pins to the bottom of the screen.
        ListHeaderComponent={transcript.busy ? <TypingIndicator /> : null}
        // `inverted` flips the whole content area as a unit, so these are
        // swapped from how they read: `paddingBottom` — normally "space
        // after the last item" — renders as reserved space at the screen's
        // visual TOP (under the header), and `paddingTop`
        // renders at the visual BOTTOM (under the floating composer).
        contentContainerStyle={[styles.content, { paddingBottom: topBarHeight + 16, paddingTop: composerHeight + keyboardHeight }]}
      />
      </ScrollViewMarker>
      {/* Feathered blur + light wash at the top (under the nav bar) and
       * bottom (screen edge). Directions are the working on-device pair —
       * top=down, bottom=up. Do not flip. Light wash uses the same ramp so
       * the edge gets lighter as it gets blurrier. */}
      {Platform.OS === "ios" ? (
        <View style={[styles.edgeBlur, { top: 0, height: TOP_BLUR_HEIGHT }]} pointerEvents="none">
          <VariableBlur blurRadius={TOP_BLUR_RADIUS} direction="down" style={StyleSheet.absoluteFill} />
          <LinearGradient
            colors={[...EDGE_LIGHT_STOPS]}
            locations={[...EDGE_LIGHT_LOCATIONS]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        </View>
      ) : null}
      {Platform.OS === "ios" ? (
        <View style={[styles.edgeBlur, { bottom: keyboardHeight, height: BOTTOM_BLUR_HEIGHT }]} pointerEvents="none">
          <VariableBlur blurRadius={BOTTOM_BLUR_RADIUS} direction="up" style={StyleSheet.absoluteFill} />
          <LinearGradient
            colors={[...EDGE_LIGHT_STOPS]}
            locations={[...EDGE_LIGHT_LOCATIONS]}
            start={{ x: 0.5, y: 1 }}
            end={{ x: 0.5, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </View>
      ) : null}
      {/* Absolutely positioned, not a flex sibling — otherwise it takes
       * layout space away from the list and nothing ever passes behind
       * it, which defeats the glass. `bottom` tracks the keyboard
       * explicitly: absolute children here are NOT offset by the parent's
       * padding (relying on that put the composer behind the keyboard). */}
      <View style={[styles.composerFloat, { bottom: keyboardHeight }]} onLayout={(e) => setComposerHeight(e.nativeEvent.layout.height)}>
        <Composer onSend={onSend} disabled={transcript.busy} bottomInset={keyboardHeight > 0 ? 0 : insets.bottom} placeholder="Message" />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  edgeBlur: {
    position: "absolute",
    left: 0,
    right: 0,
    // `top` / `bottom` / `height` are set inline — see the elements.
  },
  composerFloat: {
    position: "absolute",
    left: 0,
    right: 0,
    // `bottom` is set inline from keyboardHeight — see the element itself.
  },
  content: {
    padding: 16,
    flexGrow: 1,
  },
  empty: {
    flex: 1,
    color: colors.secondaryLabel,
    fontSize: 15,
    textAlign: "center",
    marginTop: 40,
  },
});
