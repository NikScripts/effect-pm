---
"hyperlink-ts": patch
---

**F5 split-dial:** HealthBoard / node status read from Atom.runtime node transports; explicit `Hyperlink.ws` / `connectSocket(url)` dials register in the per-Node connect memo so addressed `Hyperlink.client` reuses the override (not the tag's stamped url). HealthBoard distinguishes connecting / unreachable / healthy (never "all healthy" while pending).
