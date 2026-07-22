---
"@nikscripts/effect-pm": minor
---

**`Resource.verifyConnection` deep classification:** `{ deep: true }` dials auto-served `NodeStatus` after the cheap transport probe (same `selectEndpoint` pick as `connect`, or `{ all: true }` for every endpoint). New errors: `ProtocolUnanswered`, `ServiceNotServed`, `ServiceNotReady` (optional `resource` key). Tier-1 default unchanged.
