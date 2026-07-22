---
"hyperlink-ts": patch
---

**Host-bearing tags can now be `export`ed.** The host-bearing tag constructors used to return an inline `ResourceTag<Self, S> & { [hostSym]: HostKey<HSelf> }`, which leaked the internal `hostSym` into a consumer's declaration — so `export class Jobs extends QueueResource.Tag<Jobs>()("…", Item, { host: H }) {}` failed with TS4020 ("uses private name 'hostSym'"). They now return a named, exported `Resource.HostBoundTag<Self, S, HSelf>` interface (structurally identical, so not a behavioral change), which a consumer can name — exported host-bearing tags type-check.
