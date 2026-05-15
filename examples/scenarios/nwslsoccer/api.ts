/**
 * @module nwslsoccer/api
 *
 * Top-level {@link HttpApi} for NWSL SDP football JSON:
 *
 * - **`season`** — `getSeasonMatches`, `getSeasonTeams`, `getMatchFacts`, `getMatchPreview`
 * - **`team`** — `getTeamSeasonStats`, `getTeamRoster`
 * - **`player`** — `getPlayerProfile`
 *
 * These are the `GET` routes observed on `api-sdp.nwslsoccer.com` for `/v1/nwsl/football` (locale `en-US`).
 * Other hosts (vocabulary, widgets, ecal) are out of scope for this client.
 */
import { HttpApi } from "effect/unstable/httpapi";
import { NwslSdpPlayerGroup } from "./player-group";
import { NwslSdpSeasonGroup } from "./season-group";
import { NwslSdpTeamGroup } from "./team-group";

export const NwslsoccerApi = HttpApi.make("nwslsoccer")
  .add(NwslSdpSeasonGroup)
  .add(NwslSdpTeamGroup)
  .add(NwslSdpPlayerGroup);
