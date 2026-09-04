/**
 * Paints the current wallpaper behind the whole app and tracks the current
 * context — the scope (app / repo / worktree) and the surface (home / a page /
 * chat). Screens call `setContext` on focus; the background re-resolves. When
 * nothing resolves, the ground is just `colors.background`, so the app looks
 * exactly as before.
 *
 * @internal
 */
import * as ImagePicker from "expo-image-picker";
import * as React from "react";
import { Image, StyleSheet, View } from "react-native";
import { colors } from "./colors";
import { clearWallpaper, loadWallpapers, resolveWallpaper, scopeKey, setWallpaperImage, type WallpaperEntry, type WallpaperScope, type WallpaperSurface } from "./wallpapers";

type WallpaperContextValue = {
  readonly setContext: (scope: WallpaperScope, surface: WallpaperSurface) => void;
  readonly refresh: () => Promise<void>;
};

const WallpaperContext = React.createContext<WallpaperContextValue>({
  setContext: () => {},
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
  await setWallpaperImage(scopeKey(scope), asset.uri);
  return true;
};

export const removeWallpaper = (scope: WallpaperScope): Promise<void> => clearWallpaper(scopeKey(scope));

export const WallpaperProvider = (props: { readonly children: React.ReactNode }): React.ReactElement => {
  const [context, setContextState] = React.useState<{ scope: WallpaperScope; surface: WallpaperSurface }>({ scope: {}, surface: "home" });
  const [map, setMap] = React.useState<ReadonlyMap<string, WallpaperEntry>>(new Map());

  const refresh = React.useCallback(async (): Promise<void> => {
    setMap(new Map(await loadWallpapers()));
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const setContext = React.useCallback((scope: WallpaperScope, surface: WallpaperSurface): void => {
    setContextState({ scope, surface });
  }, []);

  const value = React.useMemo<WallpaperContextValue>(() => ({ setContext, refresh }), [setContext, refresh]);
  const uri = resolveWallpaper(map, context.scope, context.surface);

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
