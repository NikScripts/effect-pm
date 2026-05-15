/**
 * Shared NWSL SDP DTOs referenced by match, team, and player response schemas.
 */
import { Schema } from "effect";
import { NwslOptionalInstant } from "./datetime";

export const NwslImagery = Schema.Record(Schema.String, Schema.Unknown);

export class NwslStadium extends Schema.Class<NwslStadium>("NwslStadium")({
  id: Schema.optional(Schema.String),
  providerId: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  cityName: Schema.optional(Schema.String),
  country: Schema.optional(Schema.String),
  address: Schema.optional(Schema.String),
  capacity: Schema.optional(Schema.Number),
  yearOfConstruction: Schema.optional(Schema.Number),
  mapsGeoCodeLatitude: Schema.optional(Schema.String),
  mapsGeoCodeLongitude: Schema.optional(Schema.String),
  imagery: Schema.optional(NwslImagery),
}) {}

export class NwslCompetition extends Schema.Class<NwslCompetition>("NwslCompetition")({
  seasonId: Schema.String,
  competitionId: Schema.String,
  startDateUtc: NwslOptionalInstant,
  endDateUtc: NwslOptionalInstant,
  seasonName: Schema.optional(Schema.String),
  imagery: Schema.optional(NwslImagery),
  providerId: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  officialName: Schema.optional(Schema.String),
  shortName: Schema.optional(Schema.String),
  acronymName: Schema.optional(Schema.String),
  tournamentName: Schema.optional(Schema.NullOr(Schema.String)),
}) {}

export class NwslTeamEditorialSocial extends Schema.Class<NwslTeamEditorialSocial>(
  "NwslTeamEditorialSocial",
)({
  facebook: Schema.optional(Schema.String),
  instagram: Schema.optional(Schema.String),
  x: Schema.optional(Schema.String),
  tikTok: Schema.optional(Schema.String),
  youTube: Schema.optional(Schema.String),
  linkedIn: Schema.optional(Schema.String),
}) {}

export class NwslTeamEditorial extends Schema.Class<NwslTeamEditorial>("NwslTeamEditorial")({
  social: Schema.optional(NwslTeamEditorialSocial),
  websiteUrl: Schema.optional(Schema.String),
  shopUrl: Schema.optional(Schema.String),
  ticketsUrl: Schema.optional(Schema.String),
  clubPrimaryColour: Schema.optional(Schema.String),
  clubSecondaryColour: Schema.optional(Schema.String),
  clubTextColour: Schema.optional(Schema.String),
}) {}

/** Team row reused in team list, roster header, and optional player profile context. */
export class NwslTeamListRow extends Schema.Class<NwslTeamListRow>("NwslTeamListRow")({
  teamId: Schema.String,
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
