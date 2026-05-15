import * as DateTime from "effect/DateTime";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  NwslMatchFactsResponse,
  NwslMatchPreviewResponse,
  NwslMatchesResponse,
  NwslPlayerProfileResponse,
  NwslRosterResponse,
  NwslTeamStatsResponse,
  NwslTeamsResponse,
} from "../schemas";
import matchFactsMin from "./fixtures/match-facts.min.json";
import matchPreviewMin from "./fixtures/match-preview.min.json";
import matchesMin from "./fixtures/matches.min.json";
import playerProfileMin from "./fixtures/player-profile.min.json";
import rosterMin from "./fixtures/roster.min.json";
import teamStatsMin from "./fixtures/team-stats.min.json";
import teamsMin from "./fixtures/teams.min.json";

describe("nwslsoccer schemas", () => {
  it("decodes minimal matches fixture", () => {
    const decoded = Schema.decodeUnknownSync(NwslMatchesResponse)(matchesMin);
    expect(decoded.competition.seasonId).toBe("nwsl::Football_Season::test");
    expect(decoded.matches).toHaveLength(1);
    expect(decoded.matches[0]!.matchId).toBe("nwsl::Football_Match::m1");
    const kickoff = decoded.matches[0]!.matchDateUtc;
    expect(kickoff).toBeDefined();
    expect(DateTime.isUtc(kickoff!)).toBe(true);
    expect(DateTime.toEpochMillis(kickoff!)).toBe(Date.parse("2026-05-01T23:00:00.000Z"));
    const start = decoded.competition.startDateUtc;
    expect(start).toBeDefined();
    expect(DateTime.isUtc(start!)).toBe(true);
  });

  it("decodes minimal teams fixture", () => {
    const decoded = Schema.decodeUnknownSync(NwslTeamsResponse)(teamsMin);
    expect(decoded.teams).toHaveLength(1);
    expect(decoded.teams[0]!.teamId).toBe("nwsl::Football_Team::t1");
  });

  it("decodes minimal match facts fixture", () => {
    const decoded = Schema.decodeUnknownSync(NwslMatchFactsResponse)(matchFactsMin);
    expect(decoded.matchId).toBe("nwsl::Football_Match::m1");
    expect(decoded.stadium?.stadiumName).toBe("Test Ground");
  });

  it("decodes minimal match preview fixture", () => {
    const decoded = Schema.decodeUnknownSync(NwslMatchPreviewResponse)(matchPreviewMin);
    expect(decoded.matchId).toBe("nwsl::Football_Match::m1");
    expect(decoded.home).toBe("nwsl::Football_Team::home");
  });

  it("decodes minimal team stats fixture", () => {
    const decoded = Schema.decodeUnknownSync(NwslTeamStatsResponse)(teamStatsMin);
    expect(decoded.team.teamId).toBe("nwsl::Football_Team::t1");
    expect(decoded.team.stats?.[0]?.statsValue).toBe(3);
  });

  it("decodes minimal roster fixture", () => {
    const decoded = Schema.decodeUnknownSync(NwslRosterResponse)(rosterMin);
    expect(decoded.players).toHaveLength(1);
    expect(decoded.players[0]!.playerId).toBe("nwsl::Football_Player::p1");
    const dob = decoded.players[0]!.dateOfBirth;
    expect(dob).toBeDefined();
    expect(DateTime.isUtc(dob!)).toBe(true);
  });

  it("decodes minimal player profile fixture", () => {
    const decoded = Schema.decodeUnknownSync(NwslPlayerProfileResponse)(playerProfileMin);
    expect(decoded.playerId).toBe("nwsl::Football_Player::p1");
    expect(decoded.displayName).toBe("A. Player");
    expect(decoded.dateOfBirth).toBeDefined();
    expect(DateTime.isUtc(decoded.dateOfBirth!)).toBe(true);
  });
});
