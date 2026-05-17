/**
 * Path and URL-query schemas for {@link HttpApiEndpoint} bindings.
 * Identifiers use {@link Schema.String} annotations so parse errors name NWSL id kinds.
 */
import { Schema } from "effect";
import { NWSL_SDP_DEFAULT_LOCALE } from "../constants";

const SeasonId = Schema.String.annotate({
  identifier: "NwslSeasonId",
  title: "NWSL SDP season id (e.g. nwsl::Football_Season::…)",
});

const MatchId = Schema.String.annotate({
  identifier: "NwslMatchId",
  title: "NWSL SDP match id (e.g. nwsl::Football_Match::…)",
});

const TeamId = Schema.String.annotate({
  identifier: "NwslTeamId",
  title: "NWSL SDP team id (e.g. nwsl::Football_Team::…)",
});

const PlayerId = Schema.String.annotate({
  identifier: "NwslPlayerId",
  title: "NWSL SDP player id",
});

/** `?locale=en-US` on every route in this package. */
export class LocaleQuery extends Schema.Class<LocaleQuery>("LocaleQuery")({
  locale: Schema.Literal(NWSL_SDP_DEFAULT_LOCALE),
}) {}

/** Roster and player profile: `locale` + `seasonId` query params. */
export class SeasonAndLocaleQuery extends Schema.Class<SeasonAndLocaleQuery>(
  "SeasonAndLocaleQuery",
)({
  locale: Schema.Literal(NWSL_SDP_DEFAULT_LOCALE),
  seasonId: SeasonId,
}) {}

export class SeasonIdPath extends Schema.Class<SeasonIdPath>("SeasonIdPath")({
  seasonId: SeasonId,
}) {}

export class SeasonMatchIdPath extends Schema.Class<SeasonMatchIdPath>("SeasonMatchIdPath")({
  seasonId: SeasonId,
  matchId: MatchId,
}) {}

export class SeasonTeamIdPath extends Schema.Class<SeasonTeamIdPath>("SeasonTeamIdPath")({
  seasonId: SeasonId,
  teamId: TeamId,
}) {}

export class TeamIdPath extends Schema.Class<TeamIdPath>("TeamIdPath")({
  teamId: TeamId,
}) {}

export class PlayerIdPath extends Schema.Class<PlayerIdPath>("PlayerIdPath")({
  playerId: PlayerId,
}) {}
