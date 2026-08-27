/**
 * Single source of truth for composer pill sizing — `COMPOSER_BAR_HEIGHT`/
 * `_PADDING`/`_SPACING` size HomeComposerBar.tsx's own decoy pill (a
 * non-editable bar that opens the new-session picker). `COMPOSER_CHIP_SIZE`/
 * `COMPOSER_SEND_CHIP_SIZE` are also shared with SessionComposer.tsx's
 * +/send chips, so its always-editable main row visually matches
 * HomeComposerBar's chip sizing rather than drifting out of sync with it.
 *
 * @internal
 */
export const COMPOSER_BAR_HEIGHT = 40;
export const COMPOSER_CHIP_SIZE = 32;
export const COMPOSER_SEND_CHIP_SIZE = 38;
export const COMPOSER_BAR_PADDING = 10;
export const COMPOSER_BAR_SPACING = 10;
