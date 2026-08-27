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
import { FlatList, Keyboard, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppContext } from "./AppContext";
import { AGENT } from "./client";
import { colors } from "./colors";
import { MessageBubble } from "./MessageBubble";
import type { RootStackParamList } from "./RootNavigator";
import { SessionComposer } from "./SessionComposer";
import { SessionTopBar, useSessionTopBarHeight } from "./SessionTopBar";
import { TypingIndicator } from "./TypingIndicator";
import { useSessionStream } from "./useSessionStream";

type Props = NativeStackScreenProps<RootStackParamList, "Chat">;

/**
 * Deterministic keyboard-height tracking, in place of `KeyboardAvoidingView`
 * — its "padding" behavior measures its own content's height to compute how
 * much to shrink by, and that measurement was landing wrong here (visible
 * as a large gap between the composer and the keyboard). Suspected cause:
 * the composer's send button is `@expo/ui`'s `Host` with `matchContents`,
 * which resolves its final size asynchronously via a native round-trip —
 * plausibly racing with `KeyboardAvoidingView`'s own layout pass. This
 * sidesteps that entirely by tracking the keyboard's real height from
 * native events and applying it directly, no content measurement involved.
 */
const useKeyboardHeight = (): number => {
  const [height, setHeight] = React.useState(0);
  React.useEffect(() => {
    const showSub = Keyboard.addListener("keyboardWillShow", (e) => setHeight(e.endCoordinates.height));
    const hideSub = Keyboard.addListener("keyboardWillHide", () => setHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);
  return height;
};

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

  return (
    <View style={[styles.root, { paddingBottom: keyboardHeight }]}>
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
        // `inverted` flips the whole content area as a unit, so this
        // declaration's `paddingBottom` — normally "space after the last
        // item" — ends up rendering as the reserved space at the screen's
        // visual TOP (under the floating SessionTopBar), not the bottom.
        contentContainerStyle={[styles.content, { paddingBottom: topBarHeight + 16 }]}
      />
      <SessionComposer onSend={onSend} disabled={transcript.busy} bottomInset={keyboardHeight > 0 ? 0 : insets.bottom} />
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
