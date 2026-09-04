/**
 * Genuine iOS system semantic colors, not hand-picked hex — `PlatformColor`
 * resolves each name against the real `UIColor` value at render time, so
 * every one of these auto-adapts to light/dark mode and accessibility
 * settings (increased contrast, etc.) the same way system apps do, with no
 * app-side theme logic. Names are Apple's own documented `UIColor` semantic
 * palette. `accentTint` isn't a plain `PlatformColor` because there's no
 * single semantic name for "system blue at low opacity for a chip
 * background" — `DynamicColorIOS` pairs an explicit light/dark value
 * instead, using Apple's own systemBlue RGB (`#007AFF` light / `#0A84FF`
 * dark) at reduced alpha.
 *
 * @internal
 */
import { DynamicColorIOS, PlatformColor } from "react-native";

export const colors = {
  background: PlatformColor("systemGroupedBackground"),
  cardBackground: PlatformColor("secondarySystemGroupedBackground"),
  fillBackground: PlatformColor("tertiarySystemFill"),
  separator: PlatformColor("separator"),
  label: PlatformColor("label"),
  secondaryLabel: PlatformColor("secondaryLabel"),
  placeholderText: PlatformColor("placeholderText"),
  tint: PlatformColor("systemBlue"),
  destructive: PlatformColor("systemRed"),
  /** Attention/needs-input accent (e.g. a session waiting on a question). */
  warning: PlatformColor("systemOrange"),
  accentTint: DynamicColorIOS({ light: "rgba(0,122,255,0.14)", dark: "rgba(10,132,255,0.2)" }),
  /** Placeholder for the real logo/brand color (a green, per the chat-bubble
   * icon) — using systemGreen until real theme/brand color work happens.
   * Meant to be the one thing that changes when that lands, e.g. the send
   * button's tint, rather than a one-off hardcoded choice. This is the
   * theme's PRIMARY accent. */
  brand: PlatformColor("systemGreen"),
  /** The theme's SECONDARY accent (blue). Placeholder like `brand` — both
   * become theme-driven once colors come from the selected VS Code theme.
   * Used for the neutral "unread" indicator, distinct from status colors. */
  themeSecondary: PlatformColor("systemBlue"),
  /** Low-opacity systemGreen background, paired with `brand` the same way
   * `accentTint` pairs with `tint` — for the user's own chat bubble, which
   * should read as this app's identity, not a generic iMessage blue. */
  brandTint: DynamicColorIOS({ light: "rgba(52,199,89,0.14)", dark: "rgba(48,209,88,0.2)" }),
};
