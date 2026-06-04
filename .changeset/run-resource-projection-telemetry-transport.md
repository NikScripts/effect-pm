---
"@nikscripts/effect-pm": minor
---

Add RunResource live projection, hub sink modules, and telemetry transport v1.

New subpaths: `@nikscripts/effect-pm/RunResourceProjection`, `@nikscripts/effect-pm/telemetryTransport`, `@nikscripts/effect-pm/sink/ArchiveSink`, `@nikscripts/effect-pm/sink/ProjectionSink`, `@nikscripts/effect-pm/sink/BroadcastSink`. Top-level `ArchiveSink`, `ProjectionSink`, and `BroadcastSink` remain as deprecated re-export shims.

Adds `RunResourceProjection.layerLive`, `RunResourceProjection.layerHydrateFromArchive`, and `RunResourceCompose` namespace helpers. Live UI path: hub emit → projection sink + broadcast sink → `telemetryTransport` stream (no store poll on hot path).
