---
"hyperlink-ts": minor
---

Enforce owned string-literal PascalCase for clear discriminants: `LookupClientError.reason` (`Missing`/`Ambiguous`), `EffectFnMissingPayload.reason` (`Missing`/`Void`/`EmptyFields`), `SharedRoutingError.reason` (`MissingKey`/`UnknownKey`), `Daemon.ScheduleMode` (`Inline`/`Reference`), logScope tags (`All`/`Group`), and listen-target tags (`Node`/`Nameless`/`TagNodeError`). UI Router modes and Target kinds already ship PascalCase.
