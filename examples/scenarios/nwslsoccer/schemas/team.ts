/**
 * Season team list, per-team stats, and roster list payloads.
 */
import { Schema } from "effect";
import { NwslCompetition, NwslImagery, NwslStadium, NwslTeamEditorial, NwslTeamListRow } from "./common";
import { NwslOptionalInstant } from "./datetime";
import { NwslOfficial, NwslRosterPlayer } from "./player";

export class NwslTeamsResponse extends Schema.Class<NwslTeamsResponse>("NwslTeamsResponse")({
  competition: NwslCompetition,
  teams: Schema.Array(NwslTeamListRow),
  apiCallRequestTime: NwslOptionalInstant,
}) {}

export class NwslStatEntry extends Schema.Class<NwslStatEntry>("NwslStatEntry")({
  statsId: Schema.optional(Schema.String),
  statsLabel: Schema.optional(Schema.String),
  statsLabelAbbreviation: Schema.optional(Schema.String),
  statsValue: Schema.optional(Schema.NullOr(Schema.Union([Schema.Number, Schema.String]))),
  statsUnit: Schema.optional(Schema.NullOr(Schema.String)),
  statsUnitAbbreviation: Schema.optional(Schema.NullOr(Schema.String)),
}) {}

export class NwslTeamStatsPayload extends Schema.Class<NwslTeamStatsPayload>("NwslTeamStatsPayload")({
  stats: Schema.optional(Schema.Array(NwslStatEntry)),
  rankLabel: Schema.optional(Schema.NullOr(Schema.String)),
  teamId: Schema.optional(Schema.String),
  providerId: Schema.optional(Schema.String),
  shortName: Schema.optional(Schema.String),
  officialName: Schema.optional(Schema.String),
  acronymName: Schema.optional(Schema.String),
  acronymNameLocalized: Schema.optional(Schema.String),
  isTeamFake: Schema.optional(Schema.Boolean),
  mediaName: Schema.optional(Schema.String),
  mediaShortName: Schema.optional(Schema.String),
  countryCode: Schema.optional(Schema.String),
  teamType: Schema.optional(Schema.String),
  overallSummary: Schema.optional(Schema.NullOr(Schema.String)),
  stadium: Schema.optional(Schema.NullOr(NwslStadium)),
  imagery: Schema.optional(NwslImagery),
  allSeasonImagery: Schema.optional(Schema.Array(Schema.Unknown)),
  editorial: Schema.optional(NwslTeamEditorial),
}) {}

export class NwslTeamStatsResponse extends Schema.Class<NwslTeamStatsResponse>("NwslTeamStatsResponse")({
  competition: NwslCompetition,
  team: NwslTeamStatsPayload,
  apiCallRequestTime: NwslOptionalInstant,
}) {}

export class NwslRosterResponse extends Schema.Class<NwslRosterResponse>("NwslRosterResponse")({
  competition: NwslCompetition,
  team: NwslTeamListRow,
  players: Schema.Array(NwslRosterPlayer),
  officials: Schema.optional(Schema.Array(NwslOfficial)),
  apiCallRequestTime: NwslOptionalInstant,
}) {}
