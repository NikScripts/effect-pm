# NWSL SDP — Effect `HttpApi` (current layout)

Clockify-style stack:

| File | Role |
|------|------|
| `schemas/params.ts` | Path + `locale` / `seasonId` query schemas (annotated SDP ids) |
| `schemas/common.ts` | Shared DTOs (`NwslCompetition`, `NwslTeamListRow`, stadium, …) |
| `schemas/match.ts` | Schedule + match facts/preview |
| `schemas/team.ts` | Team list, stats, roster envelope |
| `schemas/player.ts` | Roster player + profile |
| `season-group.ts` | `HttpApiGroup` **season** — matches, teams, matchfacts, matchPreview |
| `team-group.ts` | **team** — season stats, roster |
| `player-group.ts` | **player** — profile |
| `api.ts` | `NwslsoccerApi` composes the three groups |
| `config.ts` | `NwslSoccerApiBaseUrl` |
| `constants.ts` | Path prefix + `nwslSdpLocaleParams()` helpers |
| `client.ts` | `NwslsoccerClient` + `Live` + `layerNode` |
| `programs.ts` | Parallel `Effect` bundles (schedule+teams, match detail, team bundle) |

Live test: `NWSL_SDP_LIVE=1` → `test/client.live.test.ts`.
