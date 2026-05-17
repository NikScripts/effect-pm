/**
 * NWSL SDP HTTP surface — single source of truth for path prefix and default query values.
 */
export const NWSL_SDP_FOOTBALL_PATH_PREFIX = "/v1/nwsl/football" as const;

/** Default `locale` query value used across all football routes in this client. */
export const NWSL_SDP_DEFAULT_LOCALE = "en-US" as const;

/** Shorthand for `urlParams` on routes that only need locale. */
export const nwslSdpLocaleParams = (): { readonly locale: typeof NWSL_SDP_DEFAULT_LOCALE } => ({
  locale: NWSL_SDP_DEFAULT_LOCALE,
});

/** Roster + player profile routes need season + locale in the query string. */
export const nwslSdpSeasonLocaleParams = (
  seasonId: string,
): { readonly locale: typeof NWSL_SDP_DEFAULT_LOCALE; readonly seasonId: string } => ({
  locale: NWSL_SDP_DEFAULT_LOCALE,
  seasonId,
});
