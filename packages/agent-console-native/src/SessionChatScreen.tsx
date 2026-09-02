/**
 * A session's chat transcript — ported from
 * packages/agent-console/src/pages/SessionChat.tsx. The header is now
 * `SessionTopBar` — three separate glass pieces (back, a wide title/status
 * center piece, a "more" stub), the same floating-overlay pattern
 * `TopBar.tsx`/`useNavBarHeight` already establishes for Home, not the
 * plain RN row this screen started with.
 *
 * @internal
 */
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as React from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppContext } from "./AppContext";
import { AGENT } from "./client";
import { colors } from "./colors";
import { MessageBubble } from "./MessageBubble";
import type { RootStackParamList } from "./RootNavigator";
import { Composer } from "./Composer";
import { SessionTopBar, useSessionTopBarHeight } from "./SessionTopBar";
import { TypingIndicator } from "./TypingIndicator";
import { useKeyboardHeight } from "./useKeyboardHeight";
import { useSessionStream } from "./useSessionStream";

type Props = NativeStackScreenProps<RootStackParamList, "Chat">;

export const SessionChatScreen = (props: Props): React.ReactElement => {
  const { client } = useAppContext();
  const sessionID = props.route.params.sessionID;
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  const topBarHeight = useSessionTopBarHeight();
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
      <FlatList
        ref={listRef}
        inverted
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
        // visual TOP (under the floating SessionTopBar), and `paddingTop`
        // renders at the visual BOTTOM (under the floating composer).
        contentContainerStyle={[styles.content, { paddingBottom: topBarHeight + 16, paddingTop: composerHeight + keyboardHeight }]}
      />
      {/* Absolutely positioned, not a flex sibling — otherwise it takes
       * layout space away from the list and nothing ever passes behind
       * it, which defeats the glass. `bottom` tracks the keyboard
       * explicitly: absolute children here are NOT offset by the parent's
       * padding (relying on that put the composer behind the keyboard). */}
      <View style={[styles.composerFloat, { bottom: keyboardHeight }]} onLayout={(e) => setComposerHeight(e.nativeEvent.layout.height)}>
        <Composer onSend={onSend} disabled={transcript.busy} bottomInset={keyboardHeight > 0 ? 0 : insets.bottom} placeholder="Message" />
      </View>
      <SessionTopBar title={title ?? sessionID} connected={connected} onBack={() => props.navigation.goBack()} />
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
