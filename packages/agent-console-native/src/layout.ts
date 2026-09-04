/**
 * Shared layout constants.
 *
 * A leaf module on purpose: these were originally exported from
 * SessionChatScreen, which imports MessageBubble, which imported the constant
 * back. Under that cycle Metro can evaluate a consumer's `StyleSheet.create`
 * before the constant is initialized, leaving `padding: undefined` — the
 * gutter silently disappeared from the whole transcript. Nothing may import
 * from here except types and primitives.
 *
 * @internal
 */

/** Horizontal inset shared by every row in the transcript. Owned by the rows
 * rather than the scroll container, so a row can opt out — full-bleed code or
 * tool output has nowhere to go if the scroll view owns the inset. */
export const ROW_GUTTER = 22;
