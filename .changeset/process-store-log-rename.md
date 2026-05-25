---
"@nikscripts/effect-pm": major
---

**Breaking — rename `ProcessStoreGroupLog` → `ProcessStoreLog`.**

The facet that persists structured log entries for the
`@nikscripts/effect-pm/Logs` capture/relay pipeline never served a single
`ProcessGroup.Service`; its bucket id (the `groupId` parameter) is an opaque
partition supplied by the relay (today the PM log annotation from
`LogContext`). The previous "GroupLog" naming implied a `ProcessGroup`-scoped
service and conflicted with the distinct `ProcessStoreProcessGroup` facet,
which actually does serve typed process groups.

Renamed surface (no compatibility shims):

- `ProcessStoreGroupLog` → `ProcessStoreLog` (service tag + class)
- `ProcessStoreGroupLogApi` → `ProcessStoreLogApi`
- `makeProcessStoreGroupLog` → `makeProcessStoreLog`
- Subpath `@nikscripts/effect-pm/store/GroupLog` → `@nikscripts/effect-pm/store/Log`
- Service key `@nikscripts/effect-pm/store/groupLog/ProcessStoreGroupLog` → `@nikscripts/effect-pm/store/log/ProcessStoreLog`
- `ProcessStoreInterface.GroupLog` → `ProcessStoreInterface.Log` (on the
  transitional `ProcessStore` monolith)
- Wire event `type: "group.log.entry"` → `type: "log.entry"` and
  `entityType: "group"` → `entityType: "log"`
- `GroupLogEntryRecordedEvent` → `LogEntryRecordedEvent`
- `isGroupLogEntryRecorded` → `isLogEntryRecorded`
- File `src/store/groupLog.ts` → `src/store/log.ts`

Existing SQLite rows with `type: "group.log.entry"` will not decode under the
new codec. Drain the durable log store or migrate rows before upgrading.

The deprecated alias `makeProcessStoreLogs` is removed.
