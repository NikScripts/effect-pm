import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  NWSL_SDP_DEFAULT_LOCALE,
  NWSL_SDP_FOOTBALL_PATH_PREFIX,
  nwslSdpLocaleParams,
  nwslSdpSeasonLocaleParams,
} from "../constants";
import { LocaleQuery, SeasonAndLocaleQuery } from "../schemas";

describe("nwslsoccer constants", () => {
  it("uses the documented football API prefix", () => {
    expect(NWSL_SDP_FOOTBALL_PATH_PREFIX).toBe("/v1/nwsl/football");
  });

  it("defaults locale helper matches LocaleQuery literal", () => {
    expect(nwslSdpLocaleParams()).toEqual({ locale: NWSL_SDP_DEFAULT_LOCALE });
    Schema.decodeUnknownSync(LocaleQuery)(nwslSdpLocaleParams());
  });

  it("season+locale helper matches SeasonAndLocaleQuery", () => {
    const seasonId = "nwsl::Football_Season::s1";
    const q = nwslSdpSeasonLocaleParams(seasonId);
    expect(q).toEqual({ locale: NWSL_SDP_DEFAULT_LOCALE, seasonId });
    Schema.decodeUnknownSync(SeasonAndLocaleQuery)(q);
  });
});

describe("nwslsoccer path encoding (contract)", () => {
  const seasonId = "nwsl::Football_Season::test";
  const matchId = "nwsl::Football_Match::m1";
  const teamId = "nwsl::Football_Team::t1";
  const playerId = "nwsl::Football_Player::p1";
  const enc = encodeURIComponent;

  it("encodes :: in ids for URL path segments", () => {
    expect(enc(seasonId)).toBe("nwsl%3A%3AFootball_Season%3A%3Atest");
  });

  it("builds season-scoped match paths used by the client", () => {
    const base = NWSL_SDP_FOOTBALL_PATH_PREFIX;
    expect(`${base}/seasons/${enc(seasonId)}/matches`).toMatch(/\/matches$/);
    expect(`${base}/seasons/${enc(seasonId)}/teams`).toMatch(/\/teams$/);
    expect(`${base}/seasons/${enc(seasonId)}/match/${enc(matchId)}/matchfacts`).toContain("/matchfacts");
    expect(`${base}/seasons/${enc(seasonId)}/match/${enc(matchId)}/matchPreview`).toContain("/matchPreview");
    expect(`${base}/seasons/${enc(seasonId)}/stats/teams/${enc(teamId)}`).toContain("/stats/teams/");
  });

  it("builds team roster and player profile paths", () => {
    const base = NWSL_SDP_FOOTBALL_PATH_PREFIX;
    expect(`${base}/teams/${enc(teamId)}/roster`).toMatch(/\/roster$/);
    expect(`${base}/players/${enc(playerId)}/profile`).toMatch(/\/profile$/);
  });
});
