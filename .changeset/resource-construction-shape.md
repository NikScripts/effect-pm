---
"@nikscripts/effect-pm": minor
---

**Unified tag construction shape (BREAKING).** Service tags now all follow the Effect `Context.Service` idiom — `Tag<Self>()(identity, …, options?)` — so `Resource.Tag` and `ApiMetrics.Tag` match the queue/process/custom-queue/run factories (which already used it). The old divergent shapes are removed (no back-compat).

Migration:

```ts
// Resource.Tag — identity moves into the second call; host moves into an options object
Resource.Tag<Self>("key")(spec)              → Resource.Tag<Self>()("key", spec)
Resource.Tag<Self>("key")(spec, Host)        → Resource.Tag<Self>()("key", spec, { host: Host })
Resource.Tag<Self>("key", { description })(spec)
                                             → Resource.Tag<Self>()("key", spec, { description })

// ApiMetrics.Tag — drop the trailing empty call
ApiMetrics.Tag<Self>(clientId)()             → ApiMetrics.Tag<Self>()(clientId)
```

Unchanged (already `<Self>()(identity, …)`): `QueueResource.Tag`, `ScheduledProcess.Tag`, `CustomQueueResource.Tag`, `ProcessScheduleResource.Tag`, `RunResource.Tag`. `Resource.tagFor` is unchanged. `host`, `kind`, and `description` are now all fields of the trailing `options` object on `Resource.Tag` (the host-bearing overload still narrows the tag so `Resource.client` resolves its transport).
