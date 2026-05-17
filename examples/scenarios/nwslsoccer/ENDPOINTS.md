# NWSL SDP football API (this package)

Reference for the **seven** `GET` JSON routes modeled by `NwslsoccerApi`. All paths are under the host from `NWSL_SOCCER_API_BASE_URL` (default `https://api-sdp.nwslsoccer.com`). Path prefix: `/v1/nwsl/football`.

Path segments that contain NWSL ids (e.g. `nwsl::Football_Season::…`) must be **URL-encoded** in real requests (`::` → `%3A%3A`).

Other NWSL hosts (vocabulary, widgets, ecal, etc.) are **not** part of this client.

## Date and time fields

Decoded as Effect **`DateTime.Utc`** (via `Schema.DateTimeUtc` in `schemas/datetime.ts`), not `Date` or raw strings. Wire values are ISO-8601 (full instants or date-only). Use `DateTime.lessThan`, `DateTime.Order`, `DateTime.add` / `subtract`, and `epochMillis` for logic.

## Endpoints

| Group  | Client method           | HTTP | Path pattern | Query |
|--------|-------------------------|------|--------------|-------|
| season | `getSeasonMatches`      | GET  | `/v1/nwsl/football/seasons/:seasonId/matches` | `locale=en-US` |
| season | `getSeasonTeams`        | GET  | `/v1/nwsl/football/seasons/:seasonId/teams` | `locale=en-US` |
| season | `getMatchFacts`         | GET  | `/v1/nwsl/football/seasons/:seasonId/match/:matchId/matchfacts` | `locale=en-US` |
| season | `getMatchPreview`       | GET  | `/v1/nwsl/football/seasons/:seasonId/match/:matchId/matchPreview` | `locale=en-US` |
| team   | `getTeamSeasonStats`    | GET  | `/v1/nwsl/football/seasons/:seasonId/stats/teams/:teamId` | `locale=en-US` |
| team   | `getTeamRoster`         | GET  | `/v1/nwsl/football/teams/:teamId/roster` | `locale=en-US`, `seasonId=<season>` |
| player | `getPlayerProfile`      | GET  | `/v1/nwsl/football/players/:playerId/profile` | `locale=en-US`, `seasonId=<season>` |

## Success schemas

| Method | Schema (export) |
|--------|-----------------|
| `getSeasonMatches` | `NwslMatchesResponse` |
| `getSeasonTeams` | `NwslTeamsResponse` |
| `getMatchFacts` | `NwslMatchFactsResponse` |
| `getMatchPreview` | `NwslMatchPreviewResponse` |
| `getTeamSeasonStats` | `NwslTeamStatsResponse` |
| `getTeamRoster` | `NwslRosterResponse` |
| `getPlayerProfile` | `NwslPlayerProfileResponse` |

## Composed programs

| Export | Parallel calls |
|--------|----------------|
| `fetchSeasonScheduleAndTeams` | `getSeasonMatches`, `getSeasonTeams` |
| `fetchMatchDetailBundle` | `getMatchFacts`, `getMatchPreview` |
| `fetchTeamSeasonBundle` | `getTeamSeasonStats`, `getTeamRoster` |

## Tests

- **Schema fixtures**: `src/nwslsoccer/test/fixtures/*.min.json` + `schemas.test.ts`
- **Constants / path encoding**: `constants-and-params.test.ts`
- **Mock `fetch` + `NwslsoccerClient.layerFetch`**: `client-fetch-mock.test.ts` (uses `createNwslSdpFetchMock` from `nwslsdp-fetch-mock.ts`; one file so Vitest workers do not fight over `globalThis.fetch`)
- **Live API** (opt-in): set `NWSL_SDP_LIVE=1` — see `client.live.test.ts`
