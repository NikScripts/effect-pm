---
"hyperlink-ts": major
---

Drop public `HyperlinkTag.groupId`. Solo RpcGroup wire prefix is the tag `.key` (`Hyperlink.wireKeyOf` / `wireKeySym`). `DuplicateGroupId` → `DuplicateWireKey`. `ServedHyperlink` and contract fingerprints use `wireKey`.
