/**
 * Paints the current wallpaper behind the whole app and tracks which scope is
 * in view. Screens call `setScope` on focus (Home → app, a repo screen → that
 * repo/worktree); the background re-resolves and updates. When no wallpaper is
 * set the ground is just the default `colors.background`, so the app looks
 * exactly as before.
 *
 * @internal
 */
import * as ImagePicker from "expo-image-picker";
import * as React from "react";
import { Image, StyleSheet, View } from "react-native";
import { colors } from "./colors";
import { clearWallpaper, loadWallpapers, resolveWallpaper, scopeKey, setWallpaper, type WallpaperScope } from "./wallpapers";

type WallpaperContextValue = {
  readonly setScope: (scope: WallpaperScope) => void;
  readonly refresh: () => Promise<void>;
};

const WallpaperContext = React.createContext<WallpaperContextValue>({
  setScope: () => {},
  refresh: async () => {},
});

export const useWallpaper = (): WallpaperContextValue => React.useContext(WallpaperContext);

/** Pick an image from the library and set it for `scope`. Returns true if set. */
export const pickWallpaper = async (scope: WallpaperScope): Promise<boolean> => {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return false;
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
  const asset = result.canceled ? undefined : result.assets?.[0];
  if (asset === undefined) return false;
  await setWallpaper(scopeKey(scope), asset.uri);
  return true;
};

export const removeWallpaper = (scope: WallpaperScope): Promise<void> => clearWallpaper(scopeKey(scope));

export const WallpaperProvider = (props: { readonly children: React.ReactNode }): React.ReactElement => {
  const [scope, setScope] = React.useState<WallpaperScope>({});
  const [map, setMap] = React.useState<ReadonlyMap<string, string>>(new Map());

  const refresh = React.useCallback(async (): Promise<void> => {
    setMap(new Map(await loadWallpapers()));
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = React.useMemo<WallpaperContextValue>(() => ({ setScope, refresh }), [refresh]);
  const uri = resolveWallpaper(map, scope);

  return (
    <WallpaperContext.Provider value={value}>
      <View style={styles.fill}>
        {uri !== undefined ? (
          <Image
            source={{ uri }}
            resizeMode="cover"
            style={StyleSheet.absoluteFill}
          />
        ) : null}
        {props.children}
      </View>
    </WallpaperContext.Provider>
  );
};

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
