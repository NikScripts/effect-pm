/**
 * Pending-key helper for control mutations.
 *
 * @module react/hooks/useControlPlaneMutation
 */
// @effect-diagnostics asyncFunction:off — React mutation helper uses Promise callbacks.

import { useCallback, useState } from "react";
import { toControlPanelErrorMessage } from "../controlPanelUtils.js";

/** @public */
export type UseControlPlaneMutationResult = {
  readonly pendingKey: string | null;
  readonly error: string | null;
  readonly run: (key: string, effect: () => Promise<void>) => Promise<void>;
  readonly clearError: () => void;
};

/**
 * Tracks one in-flight control action and surfaces errors for panels.
 *
 * @public
 */
export const useControlPlaneMutation = (): UseControlPlaneMutationResult => {
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (key: string, effect: () => Promise<void>) => {
    setPendingKey(key);
    setError(null);
    try {
      await effect();
    } catch (cause) {
      setError(toControlPanelErrorMessage(cause));
      throw cause;
    } finally {
      setPendingKey(null);
    }
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return { pendingKey, error, run, clearError };
};
