import { StatusBar } from "expo-status-bar";
import * as React from "react";
import { ActivityIndicator, Button, LayoutAnimation, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { AppContextProvider } from "./src/AppContext";
import { type OpencodeClient, makeClient } from "./src/client";
import { colors } from "./src/colors";
import { RootNavigator } from "./src/RootNavigator";
import {
  clearServerAddress,
  getDefaultPermissionMode,
  getRootDir,
  getServerAddress,
  getSessionPermissionModes,
  setRootDir,
  setServerAddress,
} from "./src/settings";
import { primeDefaultPermissionMode, primeSessionPermissionModes } from "./src/sessionPermissions";

/** Only the one-time async bootstrap (resolve a server address, connect,
 * resolve a root folder) lives in this hand-rolled state machine — once
 * `client`/`rootDir` are known, RootNavigator (a real
 * @react-navigation/native-stack) takes over for Home/Chat/Settings. This
 * flow has no "back" between its own steps (each one is just "waiting on
 * the previous async step to resolve"), so it doesn't need real navigation
 * itself. */
type Screen =
  | { readonly step: "loading" }
  | { readonly step: "server-setup"; readonly error?: string }
  | { readonly step: "connecting"; readonly address: string }
  | { readonly step: "root-setup"; readonly client: OpencodeClient; readonly address: string; readonly error?: string }
  | { readonly step: "ready"; readonly client: OpencodeClient; readonly address: string; readonly rootDir: string };

const connectToServer = async (address: string): Promise<OpencodeClient> => {
  const client = makeClient(address);
  const { data, error } = await client.session.list();
  if (error !== undefined || data === undefined) {
    const message = typeof error === "object" && error !== null && "message" in error ? String(error.message) : undefined;
    throw new Error(message ?? `Couldn't reach an OpenCode server at "${address}".`);
  }
  return client;
};

const AppInner = (): React.ReactElement => {
  const [screen, setScreenRaw] = React.useState<Screen>({ step: "loading" });
  const setScreen = (next: Screen): void => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setScreenRaw(next);
  };
  const [addressInput, setAddressInput] = React.useState("");
  const [rootDirInput, setRootDirInput] = React.useState("");
  const insets = useSafeAreaInsets();

  React.useEffect(() => {
    (async () => {
      // Primed before any session can open, so the first permission ask is
      // answered by the user's chosen default rather than the built-in one.
      primeDefaultPermissionMode(await getDefaultPermissionMode());
      primeSessionPermissionModes(await getSessionPermissionModes());
      const savedAddress = await getServerAddress();
      if (savedAddress === undefined) {
        setScreen({ step: "server-setup" });
        return;
      }
      setAddressInput(savedAddress);
      setScreen({ step: "connecting", address: savedAddress });
      try {
        const client = await connectToServer(savedAddress);
        const savedRootDir = await getRootDir();
        if (savedRootDir === undefined) {
          setScreen({ step: "root-setup", client, address: savedAddress });
        } else {
          setRootDirInput(savedRootDir);
          setScreen({ step: "ready", client, address: savedAddress, rootDir: savedRootDir });
        }
      } catch (err) {
        setScreen({ step: "server-setup", error: err instanceof Error ? err.message : String(err) });
      }
    })();
  }, []);

  const onSubmitServer = (): void => {
    const address = addressInput.trim();
    if (address.length === 0) return;
    setScreen({ step: "connecting", address });
    connectToServer(address)
      .then(async (client) => {
        void setServerAddress(address);
        const savedRootDir = await getRootDir();
        if (savedRootDir === undefined) {
          setScreen({ step: "root-setup", client, address });
        } else {
          setRootDirInput(savedRootDir);
          setScreen({ step: "ready", client, address, rootDir: savedRootDir });
        }
      })
      .catch((err: unknown) => setScreen({ step: "server-setup", error: err instanceof Error ? err.message : String(err) }));
  };

  const onSubmitRootDir = (client: OpencodeClient, address: string): void => {
    const rootDir = rootDirInput.trim();
    if (rootDir.length === 0) return;
    void setRootDir(rootDir);
    setScreen({ step: "ready", client, address, rootDir });
  };

  const onChangeServer = (): void => {
    void clearServerAddress();
    setAddressInput("");
    setScreen({ step: "server-setup" });
  };

  const onChangeRootDir = (rootDir: string): void => {
    const trimmed = rootDir.trim();
    if (trimmed.length === 0) return;
    void setRootDir(trimmed);
    setRootDirInput(trimmed);
    setScreenRaw((current) =>
      current.step === "ready" ? { ...current, rootDir: trimmed } : current,
    );
  };

  return (
    <View style={styles.root}>
      <StatusBar style="auto" />
      {screen.step === "loading" || screen.step === "connecting" ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.label} />
          {screen.step === "connecting" ? <Text style={styles.dimText}>Connecting to {screen.address}…</Text> : null}
        </View>
      ) : screen.step === "server-setup" ? (
        <View style={[styles.center, { paddingTop: insets.top }]}>
          <Text style={styles.title}>Where's your OpenCode server?</Text>
          <Text style={styles.dimText}>Host and port, e.g. 100.67.32.32:4096</Text>
          {screen.error !== undefined ? <Text style={styles.errorText}>{screen.error}</Text> : null}
          <TextInput
            style={styles.input}
            value={addressInput}
            onChangeText={setAddressInput}
            placeholder="100.67.32.32:4096"
            placeholderTextColor={colors.placeholderText}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            onSubmitEditing={onSubmitServer}
          />
          <Button title="Connect" onPress={onSubmitServer} />
        </View>
      ) : screen.step === "root-setup" ? (
        <View style={[styles.center, { paddingTop: insets.top }]}>
          <Text style={styles.title}>Where do your repos live?</Text>
          <Text style={styles.dimText}>The folder repos are checked out under, e.g. /Users/you/Coding</Text>
          {screen.error !== undefined ? <Text style={styles.errorText}>{screen.error}</Text> : null}
          <TextInput
            style={styles.input}
            value={rootDirInput}
            onChangeText={setRootDirInput}
            placeholder="/Users/you/Coding"
            placeholderTextColor={colors.placeholderText}
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={() => onSubmitRootDir(screen.client, screen.address)}
          />
          <Button title="Continue" onPress={() => onSubmitRootDir(screen.client, screen.address)} />
        </View>
      ) : (
        <AppContextProvider
          value={{
            client: screen.client,
            address: screen.address,
            rootDir: screen.rootDir,
            onChangeRootDir,
            onChangeServer,
          }}
        >
          <RootNavigator />
        </AppContextProvider>
      )}
    </View>
  );
};

export default function App() {
  return (
    <SafeAreaProvider>
      <AppInner />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 24,
  },
  title: {
    color: colors.label,
    fontSize: 20,
    fontWeight: "600",
    textAlign: "center",
  },
  dimText: {
    color: colors.secondaryLabel,
    fontSize: 15,
    textAlign: "center",
  },
  errorText: {
    color: colors.destructive,
    fontSize: 15,
    textAlign: "center",
  },
  input: {
    width: "100%",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: colors.label,
    fontSize: 17,
  },
});
