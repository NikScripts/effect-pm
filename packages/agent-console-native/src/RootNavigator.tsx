/**
 * Real native push/pop navigation — `@react-navigation/native-stack` wraps
 * the actual `UINavigationController`, giving the exact same slide
 * transition (and swipe-back gesture) iOS itself uses, not a hand-rolled
 * approximation. Mounted once app-wide dependencies (client/rootDir) are
 * resolved — see App.tsx's own bootstrap flow for everything before that.
 *
 * @internal
 */
import { DarkTheme, DefaultTheme, NavigationContainer, useNavigationContainerRef } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import * as React from "react";
import { useColorScheme } from "react-native";
import { colors } from "./colors";
import { loadNotifications, payloadOfResponse } from "./push";
import { HomeScreen } from "./HomeScreen";
import { SessionChatScreen } from "./SessionChatScreen";
import { SettingsScreen } from "./SettingsScreen";
import { RepoScreen } from "./RepoScreen";

export type RootStackParamList = {
  Home: undefined;
  Chat: { sessionID: string };
  Settings: undefined;
  // A repo (git checkout) or workspace (non-git session folder). `isRepo`
  // selects the menu variant; `dir` is the primary directory shown in the
  // header info.
  Repo: { name: string; dir: string; isRepo: boolean };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

/** react-navigation's `Theme` type requires plain string colors (it can't
 * accept `PlatformColor`, unlike a real RN `ViewStyle`), so this can't just
 * reuse colors.ts — these are Apple's own documented systemGroupedBackground/
 * secondarySystemGroupedBackground hex values, matched by mode. Needed so
 * the navigator's own background (visible during the swipe-back gesture,
 * separately from each screen's own `contentStyle`) doesn't show through as
 * a mismatched "second background" under our content. */
const LIGHT_THEME = { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: "#F2F2F7", card: "#FFFFFF" } };
const DARK_THEME = { ...DarkTheme, colors: { ...DarkTheme.colors, background: "#000000", card: "#1C1C1E" } };

export const RootNavigator = (): React.ReactElement => {
  const scheme = useColorScheme();
  const navigationRef = useNavigationContainerRef<RootStackParamList>();

  // Tapping a notification opens the session it is about. Handled here rather
  // than in a screen because the tap usually arrives with no screen mounted —
  // the app was closed, which is the case the notification exists for.
  React.useEffect(() => {
    // Loaded with require, not import(): a dynamic import in React Native
    // fetches an async chunk through the dev server and fails with
    // "Expected HMRClient.setup() call at startup".
    const notifications = loadNotifications();
    if (notifications === undefined) return;

    let cancelled = false;
    const open = (response: unknown): void => {
      const payload = payloadOfResponse(response);
      if (payload?.sessionID === undefined) return;
      navigationRef.navigate("Chat", { sessionID: payload.sessionID });
    };

    // A cold launch from a tap delivers its response before any listener can
    // attach — the app was closed, which is the case notifications exist for —
    // so the last response is replayed explicitly.
    void notifications
      .getLastNotificationResponseAsync()
      .then((last) => {
        if (last !== null && last !== undefined && !cancelled) open(last);
      })
      .catch(() => undefined);

    const subscription = notifications.addNotificationResponseReceivedListener(open);
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [navigationRef]);

  return (
    <NavigationContainer ref={navigationRef} theme={scheme === "dark" ? DARK_THEME : LIGHT_THEME}>
      <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
        {/* `scrollEdgeEffects` is deliberately NOT set here — each screen
         * applies it via `useScrollEdgeEffects` after mount instead. See
         * that hook for why a static option silently does nothing. */}
        {/* Native prop delivery is confirmed working — a `statusBarStyle`
         * probe reached RNSScreen's native side and came back with its own
         * Info.plist warning, so silent no-ops from `scrollEdgeEffects`
         * are that feature's own problem, not a stale binary.
         *
         * `UIScrollEdgeEffect` draws into the scroll view's safe-area inset
         * region, so the list also needs `contentInsetAdjustmentBehavior`
         * set — see HomeScreen's own note. */}
        {/* An empty, fully transparent real UINavigationBar — no title, no
         * back button, nothing drawn. It exists only so iOS 26's scroll
         * edge effect has a bar edge to anchor against: that effect renders
         * where scrolling content meets a bar, and with `headerShown: false`
         * there is no bar, which fits every no-op result so far (the props
         * demonstrably reach native and ScrollViewMarker resolves the scroll
         * view without assertion). headerStyle's explicit transparent
         * background matters — headerTransparent alone let the theme's
         * `card` color paint it opaque white. */}
        <Stack.Screen
          name="Home"
          component={HomeScreen}
          options={({ navigation }) => ({
            headerShown: true,
            headerTransparent: true,
            headerStyle: { backgroundColor: "transparent" },
            headerTitle: "",
            headerBackVisible: false,
            headerShadowVisible: false,
            // Real native header items rather than @expo/ui Hosts dropped
            // into headerLeft/headerRight. The nav bar then owns their
            // glass, grouping and spacing — rendering our own glassEffect
            // inside a slot nested a second capsule in the system's, and
            // packing two buttons into one slot grouped them wrongly.
            unstable_headerLeftItems: () => [
              {
                type: "button",
                label: "Settings",
                icon: { type: "sfSymbol", name: "gearshape" },
                onPress: () => navigation.navigate("Settings"),
              },
            ],
            unstable_headerRightItems: () => [
              {
                type: "button",
                label: "Search",
                icon: { type: "sfSymbol", name: "magnifyingglass" },
                onPress: () => {},
              },
              // Adjacent items share one glass capsule; a spacing item
              // between them breaks that grouping so each gets its own
              // circle, matching the single left-hand button.
              { type: "spacing", spacing: 24 },
              {
                type: "button",
                label: "New repo or empty project",
                icon: { type: "sfSymbol", name: "folder.badge.plus" },
                onPress: () => {},
              },
            ],
            scrollEdgeEffects: { top: "soft", bottom: "soft" },
          })}
        />
        {/* Same treatment as Home — a real but invisible header, so iOS
         * 26's scroll edge effect has a bar to anchor to. Back is the
         * system's own (free swipe-back), "more" is a native item, and the
         * title/connection dot is set from the screen itself via
         * setOptions, since both are screen state. */}
        <Stack.Screen
          name="Chat"
          component={SessionChatScreen}
          options={{
            headerShown: true,
            headerTransparent: true,
            headerStyle: { backgroundColor: "transparent" },
            headerShadowVisible: false,
            headerBackButtonDisplayMode: "minimal",
            headerTitle: "",
            // No headerBlurEffect: the nav bar's own material is uniform
            // with a hard bottom edge, which would paint over the feathered
            // VariableBlur this screen renders itself.
            scrollEdgeEffects: { top: "soft", bottom: "soft" },
          }}
        />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        {/* Repo/workspace screen draws its own fully custom collapsing glass
         * header, so the native bar is hidden. */}
        <Stack.Screen
          name="Repo"
          component={RepoScreen}
          options={{ headerShown: false }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
};
