/**
 * Single source of truth for the composer's +/send chip sizing, shared by
 * every screen that renders `Composer.tsx` (chat and Home both do) so the
 * two can't drift apart.
 *
 * Previously this also carried `COMPOSER_BAR_HEIGHT`/`_PADDING`/`_SPACING`,
 * which sized `HomeComposerBar.tsx`'s decoy pill — a non-editable bar that
 * stood in for a composer on Home. That component is gone; Home now renders
 * the real `Composer` directly, so those constants had no remaining
 * consumer.
 *
 * @internal
 */
export const COMPOSER_CHIP_SIZE = 32;
export const COMPOSER_SEND_CHIP_SIZE = 38;
