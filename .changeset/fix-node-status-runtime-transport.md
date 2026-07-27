---
"hyperlink-ts": patch
---

HealthBoard / node status now read from the Atom.runtime's node transports (e.g. vite-proxied `Hyperlink.ws` urls) instead of auto-dialing each tag's stamped server address — fixes "all healthy" + stuck "connecting…" when the page isn't on localhost.
