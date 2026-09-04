/**
 * How many sessions to show per section (Recent, and each worktree group)
 * before a "See all" — scaled to screen height so every phone shows 3 and
 * only tablets/larger show more. Shared by Home and the repo screen so both
 * stay in step.
 *
 * Base 3, +1 per ~160pt of height above ~950 (just past the tallest phone),
 * clamped to 7.
 *
 * @internal
 */
import { useWindowDimensions } from "react-native";

const MIN = 3;
const MAX = 7;
const BASELINE = 950;
const STEP = 160;

export const useGroupSize = (): number => {
  const { height } = useWindowDimensions();
  return Math.max(MIN, Math.min(MAX, MIN + Math.floor(Math.max(0, height - BASELINE) / STEP)));
};
