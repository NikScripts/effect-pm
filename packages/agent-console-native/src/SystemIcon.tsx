/**
 * A single real SF Symbol, sized to its own content — for spots inline in
 * an otherwise-plain-RN layout (a FlatList row) that don't warrant a whole
 * bespoke SwiftUI subtree the way TopBar's nav bar does. `@expo/ui`'s Image
 * `color` prop is `ColorValue`-typed, so it accepts `PlatformColor` (see
 * colors.ts) directly — unlike lucide-react-native's icon `color`, which is
 * a plain `string` and can't.
 *
 * `size` alone sizes the symbol via a `font({ size })` modifier under the
 * hood (see @expo/ui's own Image source) — that gives the glyph a
 * font-metrics box (ascender/descender-style padding), not a tight square,
 * so the visible glyph can sit visibly off-center within it, especially
 * inside a small circular chip background where the asymmetry is obvious.
 * The explicit `frame` modifier below forces a tight square matching
 * `size`, and SwiftUI's `.frame()` centers content within it by default —
 * that's what actually centers the glyph, not anything in the RN-side
 * flex layout wrapping this component.
 *
 * `Host` keeps `matchContents` — dropping it in favor of an explicit
 * `style` size (tried once here, and separately on SessionComposer's
 * controls row earlier) didn't just lose auto-sizing, it broke rendering
 * outright both times. Whatever content-mounting path `Host` uses
 * apparently depends on `matchContents` being present, not just on it for
 * sizing.
 *
 * It also gets an explicit `style` size alongside `matchContents`, not
 * instead of it — off-center icons kept recurring whenever something
 * elsewhere in the tree changed the surrounding layout timing (e.g.
 * SessionComposer's field gaining a wrapping View for its own, unrelated
 * reasons). The likely mechanism: `matchContents`'s native measurement
 * round-trip (`GeometryChangeModifier` in `HostView.swift`, see
 * SessionComposer.tsx's own top comment) can settle using `Host`'s box
 * from *before* the `frame` modifier below finishes applying — Host ends
 * up sized to the glyph's original, unconstrained font-metrics box, with
 * the now-correctly-tight glyph sitting top-leading inside it. An
 * explicit starting size doesn't stop that race from being possible, but
 * it means the two sizes usually agree (both are `size`×`size`) even when
 * it happens, instead of Host's box being whatever it happened to measure
 * before the frame modifier caught up.
 *
 * @internal
 */
import { Host, Image } from "@expo/ui/swift-ui";
import { frame } from "@expo/ui/swift-ui/modifiers";
import * as React from "react";
import type { ColorValue } from "react-native";
import type { SFSymbol } from "sf-symbols-typescript";

export const SystemIcon = (props: { readonly name: SFSymbol; readonly size: number; readonly color: ColorValue }): React.ReactElement => (
  <Host matchContents style={{ width: props.size, height: props.size }}>
    <Image systemName={props.name} size={props.size} color={props.color} modifiers={[frame({ width: props.size, height: props.size })]} />
  </Host>
);
