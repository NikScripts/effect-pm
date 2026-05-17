/**
 * Shared fixture shape for NWSL SDP mock responses (see {@link createNwslSdpFetchMock}).
 */
export type NwslSdpMockFixtures = {
  readonly matches: unknown;
  readonly teams: unknown;
  readonly matchFacts: unknown;
  readonly matchPreview: unknown;
  readonly teamStats: unknown;
  readonly roster: unknown;
  readonly playerProfile: unknown;
};
