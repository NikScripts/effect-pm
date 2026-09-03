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
import { ActionSheetIOS, FlatList, StyleSheet, Text, Vibration, View } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollViewMarker } from "react-native-screens/src/components/gamma/scroll-view-marker";
import { useAppContext } from "./AppContext";
import { AGENT } from "./client";
import { BusyRow } from "./BusyRow";
import { CollapsiblePartsProvider } from "./CollapsibleParts";
import { colors } from "./colors";
import { ROW_GUTTER } from "./layout";
import { EdgeBlurBars } from "./EdgeBlurBars";
import { MessageBubble } from "./MessageBubble";
import { PermissionPrompt } from "./PermissionPrompt";
import { getPermissionMode, setPermissionMode, type PermissionMode } from "./sessionPermissions";
import type { RootStackParamList } from "./RootNavigator";
import { Composer } from "./Composer";
import type { ModelOption } from "./models";
import { findModel, listModels } from "./models";
import { SessionHeaderTitle } from "./SessionHeaderTitle";
import { useKeyboardHeight } from "./useKeyboardHeight";
import { useSessionStream } from "./useSessionStream";
import { useStreamEnabled } from "./useStreamEnabled";

type Props = NativeStackScreenProps<RootStackParamList, "Chat">;

/** Sentinel row id for the pending-permission bubble. Prefixed so it can
 * never collide with a real message id (`msg_…`). */
const PERMISSION_ROW_ID = "__permission__";

export const SessionChatScreen = (props: Props): React.ReactElement => {
  const { client, address } = useAppContext();
  const sessionID = props.route.params.sessionID;
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  // Transparent header, so content sits under it and pads itself by the
  // header's real height. On this inverted list that padding is
  // `paddingBottom` — see the contentContainerStyle note below.
  const topBarHeight = useHeaderHeight();
  const streamEnabled = useStreamEnabled();
  const { transcript, pendingPermission, replyPermission, markBusy, clearBusy, sendOptimistic, connected } =
    useSessionStream(client, sessionID, address, streamEnabled);
  // Mirrors the module-level store so the menu re-renders with the choice.
  const [permissionMode, setMode] = React.useState<PermissionMode>(() => getPermissionMode(sessionID));
  const [title, setTitle] = React.useState<string | undefined>(undefined);
  // Newest-first — paired with `inverted` below, which should anchor the
  // list to the newest message on its own. In practice it wasn't sticking
  // reliably, so this still explicitly re-pins to `offset: 0` (an
  // inverted list's "start", i.e. its bottom) whenever a message is
  // appended — the same role the old `scrollToEnd` played pre-inversion.
  const reversedOrder = React.useMemo(() => [...transcript.order].reverse(), [transcript.order]);
  const listRef = React.useRef<FlatList<string>>(null);
  // The one collapsible allowed to be open by default: the most recent
  // reasoning block or tool call anywhere in the transcript. Scanned newest
  // message first so a long history costs nothing — it exits on the first hit.
  // A pending permission is a real row in the list. `reversedOrder` is
  // newest-first (the list is inverted), so prepending puts it at the visual
  // bottom — in order, where it happened.
  const listData = React.useMemo(
    () => (pendingPermission === undefined ? reversedOrder : [PERMISSION_ROW_ID, ...reversedOrder]),
    [pendingPermission, reversedOrder],
  );

  const newestCollapsibleID = React.useMemo(() => {
    for (let i = transcript.order.length - 1; i >= 0; i -= 1) {
      const message = transcript.messages.get(transcript.order[i]);
      if (message === undefined) continue;
      const parts = Array.from(message.parts.values());
      for (let j = parts.length - 1; j >= 0; j -= 1) {
        const part = parts[j];
        if (part.type === "reasoning" || part.type === "tool") return part.id;
      }
    }
    return undefined;
  }, [transcript]);
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

  const applyPermissionMode = React.useCallback(
    (next: PermissionMode) => {
      setPermissionMode(sessionID, next);
      setMode(next);
    },
    [sessionID],
  );

  // Confirmation stays an action sheet: it is a decision, not navigation, and
  // it only guards the direction that grants power. Switching back to asking
  // takes effect immediately.
  const confirmAllowAll = React.useCallback(() => {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: "Allow all tool actions?",
        message:
          "Tools run without asking for the rest of this session, including shell commands and delegating to a subagent that has its own unrestricted permissions.",
        options: ["Allow all", "Cancel"],
        destructiveButtonIndex: 0,
        cancelButtonIndex: 1,
      },
      (index) => {
        if (index === 0) applyPermissionMode("full");
      },
    );
  }, [applyPermissionMode]);

  // Title and connection state are screen state, so they reach the header
  // through setOptions rather than static screen options.
  React.useEffect(() => {
    props.navigation.setOptions({
      headerTitle: () => <SessionHeaderTitle title={title ?? sessionID} connected={connected} />,
      unstable_headerRightItems: () => [
        {
          type: "menu",
          label: "More",
          icon: { type: "sfSymbol", name: "ellipsis" },
          menu: {
            title: "Agent permissions",
            items: [
              {
                type: "action",
                label: "Allow all",
                description: "Tools run without asking",
                state: permissionMode === "full" ? "on" : "off",
                // Destructive because choosing it grants shell access and
                // subagent delegation for the rest of the session.
                destructive: permissionMode !== "full",
                onPress: () => {
                  if (permissionMode !== "full") confirmAllowAll();
                },
              },
              {
                type: "action",
                label: "Ask before each action",
                description: "Each tool action waits for approval",
                state: permissionMode === "ask" ? "on" : "off",
                onPress: () => applyPermissionMode("ask"),
              },
            ],
          },
        },
      ],
    });
  }, [props.navigation, title, sessionID, connected, permissionMode, confirmAllowAll, applyPermissionMode]);

  React.useEffect(() => {
    setTitle(undefined);
    client.session
      .get({ path: { id: sessionID } })
      .then(({ data }) => setTitle(data?.title))
      .catch(() => {
        // Non-critical — the header just shows the raw id as a fallback.
      });
  }, [client, sessionID]);

  // Abort the running turn. `clearBusy` runs regardless: if the request
  // fails the run may still be going server-side, but leaving the UI pinned
  // to "busy" with a Stop button that did nothing is worse — session.idle
  // will correct it either way.
  const onStop = async (): Promise<void> => {
    try {
      await client.session.abort({ path: { id: sessionID } });
    } finally {
      clearBusy();
    }
  };

  const onSend = async (text: string, model: ModelOption | undefined): Promise<void> => {
    sendOptimistic(text);
    markBusy();
    try {
      await client.session.promptAsync({
        path: { id: sessionID },
        body: {
          agent: AGENT,
          parts: [{ type: "text", text }],
          model:
            model === undefined
              ? undefined
              : { providerID: model.providerID, modelID: model.modelID },
        },
      });
    } catch (err) {
      clearBusy();
      throw err;
    }
  };

  const seedModel = React.useMemo((): ModelOption | undefined => {
    for (let i = transcript.order.length - 1; i >= 0; i -= 1) {
      const message = transcript.messages.get(transcript.order[i]!);
      if (message?.role !== "assistant" || message.providerID === undefined || message.modelID === undefined) {
        continue;
      }
      return {
        providerID: message.providerID,
        providerName: message.providerID,
        modelID: message.modelID,
        name: message.modelID,
      };
    }
    return undefined;
  }, [transcript]);

  const [resolvedSeed, setResolvedSeed] = React.useState<ModelOption | undefined>(undefined);
  React.useEffect(() => {
    if (seedModel === undefined) {
      setResolvedSeed(undefined);
      return;
    }
    let cancelled = false;
    void listModels(client).then((options) => {
      if (cancelled) return;
      setResolvedSeed(findModel(options, seedModel.providerID, seedModel.modelID) ?? seedModel);
    });
    return () => {
      cancelled = true;
    };
  }, [client, seedModel?.providerID, seedModel?.modelID]); // eslint-disable-line react-hooks/exhaustive-deps

  // No `paddingBottom: keyboardHeight` on root — the composer is
  // absolutely positioned, and absolute children weren't being offset by
  // that padding (they sat behind the keyboard instead), so both the
  // composer and the list account for the keyboard explicitly below
  // rather than relying on padding-box positioning semantics.
  return (
    <CollapsiblePartsProvider newestID={newestCollapsibleID}>
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
        data={listData}
        keyExtractor={(id) => id}
        renderItem={({ item }) => {
          if (item === PERMISSION_ROW_ID) {
            return pendingPermission === undefined ? null : (
              <PermissionPrompt
                pending={pendingPermission}
                onReply={(reply) => {
                  void replyPermission(reply);
                }}
              />
            );
          }
          const message = transcript.messages.get(item);
          return message === undefined ? null : <MessageBubble message={message} />;
        }}
        ListEmptyComponent={<Text style={styles.empty}>Ask a question, or ask it to make a change.</Text>}
        // Below the newest message, not above the oldest — the header, not
        // the footer, is what renders nearest the (inverted) start of the
        // list, which an inverted list pins to the bottom of the screen.
        ListHeaderComponent={transcript.busy ? <BusyRow onStop={onStop} /> : null}
        // `inverted` flips the whole content area as a unit, so these are
        // swapped from how they read: `paddingBottom` — normally "space
        // after the last item" — renders as reserved space at the screen's
        // visual TOP (under the header), and `paddingTop`
        // renders at the visual BOTTOM (under the floating composer).
        contentContainerStyle={[styles.content, { paddingBottom: topBarHeight + 16, paddingTop: composerHeight + keyboardHeight }]}
      />
      </ScrollViewMarker>
      <EdgeBlurBars bottomInset={keyboardHeight} busy={transcript.busy} />
      {/* Absolutely positioned, not a flex sibling — otherwise it takes
       * layout space away from the list and nothing ever passes behind
       * it, which defeats the glass. `bottom` tracks the keyboard
       * explicitly: absolute children here are NOT offset by the parent's
       * padding (relying on that put the composer behind the keyboard). */}
      <View style={[styles.composerFloat, { bottom: keyboardHeight }]} onLayout={(e) => setComposerHeight(e.nativeEvent.layout.height)}>
        <Composer
          onSend={onSend}
          disabled={transcript.busy}
          bottomInset={keyboardHeight > 0 ? 0 : insets.bottom}
          placeholder="Message"
          seedModel={resolvedSeed}
        />
      </View>
    </View>
    </CollapsiblePartsProvider>
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
    // Vertical only. The horizontal gutter belongs to each row (see
    // MessageBubble, BusyRow, PermissionPrompt) so a row can opt out of it —
    // full-bleed code or tool output has nowhere to go if the scroll
    // container owns the inset.
    paddingVertical: 16,
    flexGrow: 1,
  },
  empty: {
    flex: 1,
    paddingHorizontal: ROW_GUTTER,
    color: colors.secondaryLabel,
    fontSize: 15,
    textAlign: "center",
    marginTop: 40,
  },
});
