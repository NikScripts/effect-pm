/**
 * Match schedule, facts, and preview payloads.
 */
import { Schema } from "effect";
import { NwslCompetition, NwslImagery, NwslStadium } from "./common";
import { NwslOptionalInstant } from "./datetime";

export class NwslMatchEditorial extends Schema.Class<NwslMatchEditorial>("NwslMatchEditorial")({
  broadcasters: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  highlightsUrl: Schema.optional(Schema.String),
  highlightsNationalUrl: Schema.optional(Schema.String),
  highlightsInternationalUrl: Schema.optional(Schema.String),
  ticketsUrl: Schema.optional(Schema.String),
  sponsorImage: Schema.optional(Schema.String),
  themeNight: Schema.optional(Schema.String),
}) {}

export class NwslPreviewTeamSide extends Schema.Class<NwslPreviewTeamSide>("NwslPreviewTeamSide")({
  form: Schema.optional(Schema.Array(Schema.String)),
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
}) {}

/** Schedule rows may use a team id string or an embedded team object. */
export const NwslMatchTeamSide = Schema.Union([NwslPreviewTeamSide, Schema.String]);

export class NwslMatchRow extends Schema.Class<NwslMatchRow>("NwslMatchRow")({
  providerId: Schema.optional(Schema.String),
  seasonId: Schema.optional(Schema.String),
  editorial: Schema.optional(NwslMatchEditorial),
  matchId: Schema.String,
  status: Schema.optional(Schema.String),
  providerStatus: Schema.optional(Schema.NullOr(Schema.String)),
  phase: Schema.optional(Schema.String),
  matchDateUtc: NwslOptionalInstant,
  matchDateLocal: NwslOptionalInstant,
  localTimeUtcOffset: Schema.optional(Schema.String),
  homeScorePush: Schema.optional(Schema.NullOr(Schema.Number)),
  awayScorePush: Schema.optional(Schema.NullOr(Schema.Number)),
  providerPenaltyScoreHome: Schema.optional(Schema.NullOr(Schema.Number)),
  providerPenaltyScoreAway: Schema.optional(Schema.NullOr(Schema.Number)),
  aggregate: Schema.optional(Schema.Unknown),
  winReason: Schema.optional(Schema.NullOr(Schema.String)),
  winTeamId: Schema.optional(Schema.NullOr(Schema.String)),
  previousLegsResult: Schema.optional(Schema.Unknown),
  home: NwslMatchTeamSide,
  away: NwslMatchTeamSide,
  stadiumId: Schema.optional(Schema.NullOr(Schema.String)),
  stadiumName: Schema.optional(Schema.NullOr(Schema.String)),
  cityName: Schema.optional(Schema.NullOr(Schema.String)),
  group: Schema.optional(Schema.NullOr(Schema.String)),
  groupName: Schema.optional(Schema.NullOr(Schema.String)),
  roundId: Schema.optional(Schema.NullOr(Schema.String)),
  roundName: Schema.optional(Schema.NullOr(Schema.String)),
  matchSet: Schema.optional(Schema.Unknown),
  scheduleStatus: Schema.optional(Schema.String),
  providerHomeScore: Schema.optional(Schema.NullOr(Schema.Number)),
  providerAwayScore: Schema.optional(Schema.NullOr(Schema.Number)),
  groupId: Schema.optional(Schema.NullOr(Schema.String)),
  subLeague: Schema.optional(Schema.Unknown),
  time: Schema.optional(Schema.NullOr(Schema.Number)),
  additionalTime: Schema.optional(Schema.NullOr(Schema.Number)),
}) {}

export class NwslMatchesResponse extends Schema.Class<NwslMatchesResponse>("NwslMatchesResponse")({
  competition: NwslCompetition,
  matches: Schema.Array(NwslMatchRow),
  apiCallRequestTime: NwslOptionalInstant,
}) {}

export class NwslMatchFactsStadium extends Schema.Class<NwslMatchFactsStadium>(
  "NwslMatchFactsStadium",
)({
  stadiumId: Schema.optional(Schema.String),
  stadiumLabel: Schema.optional(Schema.NullOr(Schema.String)),
  stadiumName: Schema.optional(Schema.String),
  mapsGeoCodeLatitude: Schema.optional(Schema.String),
  mapsGeoCodeLongitude: Schema.optional(Schema.String),
  images: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}) {}

export class NwslMatchFactsLocation extends Schema.Class<NwslMatchFactsLocation>(
  "NwslMatchFactsLocation",
)({
  locationLabel: Schema.optional(Schema.NullOr(Schema.String)),
  cityName: Schema.optional(Schema.String),
}) {}

export class NwslReferee extends Schema.Class<NwslReferee>("NwslReferee")({
  refereeId: Schema.optional(Schema.String),
  roleLabel: Schema.optional(Schema.String),
  role: Schema.optional(Schema.String),
  mediaFirstName: Schema.optional(Schema.String),
  mediaLastName: Schema.optional(Schema.String),
  shortName: Schema.optional(Schema.String),
  displayName: Schema.optional(Schema.String),
  nationality: Schema.optional(Schema.String),
  nationalityIsoCode: Schema.optional(Schema.NullOr(Schema.String)),
  providerId: Schema.optional(Schema.String),
}) {}

export class NwslMatchFactsResponse extends Schema.Class<NwslMatchFactsResponse>(
  "NwslMatchFactsResponse",
)({
  matchId: Schema.String,
  status: Schema.optional(Schema.String),
  providerStatus: Schema.optional(Schema.NullOr(Schema.String)),
  phase: Schema.optional(Schema.String),
  events: Schema.optional(Schema.Unknown),
  scheduleStatus: Schema.optional(Schema.String),
  stadium: Schema.optional(NwslMatchFactsStadium),
  location: Schema.optional(NwslMatchFactsLocation),
  referees: Schema.optional(Schema.Array(NwslReferee)),
  enviroment: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  apiCallRequestTime: NwslOptionalInstant,
}) {}

const PreviewOrString = Schema.Union([NwslPreviewTeamSide, Schema.String]);

export class NwslMatchPreviewResponse extends Schema.Class<NwslMatchPreviewResponse>(
  "NwslMatchPreviewResponse",
)({
  matchId: Schema.String,
  status: Schema.optional(Schema.String),
  phase: Schema.optional(Schema.String),
  time: Schema.optional(Schema.Number),
  additionalTime: Schema.optional(Schema.Number),
  home: Schema.optional(PreviewOrString),
  away: Schema.optional(PreviewOrString),
  headToHead: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  headToHeadAnyComp: Schema.optional(Schema.Unknown),
  lastMatches: Schema.optional(Schema.Array(Schema.Unknown)),
  lastMatchesAnyComp: Schema.optional(Schema.Unknown),
  homeRecentResults: Schema.optional(Schema.Array(Schema.Unknown)),
  awayRecentResults: Schema.optional(Schema.Array(Schema.Unknown)),
  editorial: Schema.optional(NwslMatchEditorial),
  providerHomeScore: Schema.optional(Schema.NullOr(Schema.Number)),
  providerAwayScore: Schema.optional(Schema.NullOr(Schema.Number)),
  apiCallRequestTime: NwslOptionalInstant,
}) {}
