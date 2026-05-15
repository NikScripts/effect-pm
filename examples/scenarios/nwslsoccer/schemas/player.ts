/**
 * Player roster rows, staff, and profile payloads.
 */
import { Schema } from "effect";
import { NwslImagery, NwslTeamListRow } from "./common";
import { NwslOptionalInstant } from "./datetime";

export class NwslRosterInfoRow extends Schema.Class<NwslRosterInfoRow>("NwslRosterInfoRow")({
  infoId: Schema.optional(Schema.String),
  infoLabel: Schema.optional(Schema.String),
  infoLabelAbbreviation: Schema.optional(Schema.String),
  infoValue: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
}) {}

export class NwslRosterPlayerEditorial extends Schema.Class<NwslRosterPlayerEditorial>(
  "NwslRosterPlayerEditorial",
)({
  playerRoleWithinTeam: Schema.optional(Schema.String),
}) {}

export class NwslRosterPlayer extends Schema.Class<NwslRosterPlayer>("NwslRosterPlayer")({
  info: Schema.optional(Schema.Array(NwslRosterInfoRow)),
  imagery: Schema.optional(NwslImagery),
  dateOfBirth: NwslOptionalInstant,
  height: Schema.optional(Schema.String),
  weight: Schema.optional(Schema.String),
  playerStatus: Schema.optional(Schema.String),
  leaveDate: NwslOptionalInstant,
  playerId: Schema.String,
  providerId: Schema.optional(Schema.String),
  bibNumber: Schema.optional(Schema.String),
  roleLabel: Schema.optional(Schema.String),
  role: Schema.optional(Schema.Number),
  mediaFirstName: Schema.optional(Schema.String),
  mediaLastName: Schema.optional(Schema.String),
  shirtName: Schema.optional(Schema.String),
  shortName: Schema.optional(Schema.String),
  displayName: Schema.optional(Schema.String),
  nationality: Schema.optional(Schema.String),
  nationalityIsoCode: Schema.optional(Schema.String),
  editorial: Schema.optional(NwslRosterPlayerEditorial),
  apiCallRequestTime: NwslOptionalInstant,
}) {}

export class NwslOfficial extends Schema.Class<NwslOfficial>("NwslOfficial")({
  status: Schema.optional(Schema.String),
  providerId: Schema.optional(Schema.String),
  shortName: Schema.optional(Schema.String),
  displayName: Schema.optional(Schema.String),
  mediaFirstName: Schema.optional(Schema.String),
  mediaLastName: Schema.optional(Schema.String),
  staffId: Schema.optional(Schema.String),
  roleLabel: Schema.optional(Schema.String),
  nationality: Schema.optional(Schema.String),
  nationalityIsoCode: Schema.optional(Schema.String),
  dateOfBirth: NwslOptionalInstant,
  imagery: Schema.optional(NwslImagery),
}) {}

export class NwslPlayerProfileResponse extends Schema.Class<NwslPlayerProfileResponse>(
  "NwslPlayerProfileResponse",
)({
  team: Schema.optional(NwslTeamListRow),
  dateOfBirth: NwslOptionalInstant,
  height: Schema.optional(Schema.String),
  weight: Schema.optional(Schema.String),
  playerStatus: Schema.optional(Schema.String),
  leaveDate: NwslOptionalInstant,
  playerId: Schema.String,
  providerId: Schema.optional(Schema.String),
  bibNumber: Schema.optional(Schema.String),
  roleLabel: Schema.optional(Schema.String),
  role: Schema.optional(Schema.Number),
  mediaFirstName: Schema.optional(Schema.String),
  mediaLastName: Schema.optional(Schema.String),
  shirtName: Schema.optional(Schema.String),
  shortName: Schema.optional(Schema.String),
  displayName: Schema.optional(Schema.String),
  nationality: Schema.optional(Schema.String),
  nationalityIsoCode: Schema.optional(Schema.String),
  editorial: Schema.optional(NwslRosterPlayerEditorial),
  imagery: Schema.optional(NwslImagery),
  apiCallRequestTime: NwslOptionalInstant,
}) {}
