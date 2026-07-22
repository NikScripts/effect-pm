import { Schema } from "effect";
import * as QueueResource from "../src/QueueResource";
import type {
  QueueEntry,
  QueueEvent,
  QueueMetrics,
  QueueReleaseOptions,
} from "../src/internal/queueResource";
import * as Hyperlink from "../src/Hyperlink";

// SSOT drift guard (Stage-2 M6): each hand-authored PUBLIC type must stay structurally equal to its
// schema `.Type`. They are kept as explicit `interface`s (owner rule — public types are not
// schema-derived aliases), so this proves equality by **bidirectional assignment** (each direction a
// direct assignment, no casts). That is the meaningful SSOT check: it fails the build on any real
// drift — a missing / extra / wrong-typed field — while tolerating harmless modifier cosmetics
// (`readonly`, `optional` vs `optionalKey`) that don't affect correctness. If a slot ever drifts, the
// fix is retain-narrower: tighten the schema to the type, never widen the type to a looser schema.

const EmailJob = Schema.Struct({ to: Schema.String });
const entrySchema = QueueResource.queueEntry(EmailJob);
// concrete Success/Error slots so the event union reduces
const eventSchema = QueueResource.queueEvent(EmailJob, {
  success: Schema.Number,
  error: Schema.String,
});

// ── QueueMetrics ⇄ queueMetrics.Type ─────────────────────────────────────────────
declare const hMetrics: QueueMetrics;
declare const sMetrics: Hyperlink.Decoded<typeof QueueResource.queueMetrics>;
const _metricsToSchema: Hyperlink.Decoded<typeof QueueResource.queueMetrics> = hMetrics;
const _metricsToType: QueueMetrics = sMetrics;

// ── QueueReleaseOptions ⇄ queueReleaseOptions.Type ───────────────────────────────
declare const hRelease: QueueReleaseOptions;
declare const sRelease: Hyperlink.Decoded<typeof QueueResource.queueReleaseOptions>;
const _releaseToSchema: Hyperlink.Decoded<typeof QueueResource.queueReleaseOptions> = hRelease;
const _releaseToType: QueueReleaseOptions = sRelease;

// ── QueueEntry<T> ⇄ queueEntry(itemSchema).Type ──────────────────────────────────
declare const hEntry: QueueEntry<Hyperlink.Decoded<typeof EmailJob>>;
declare const sEntry: Hyperlink.Decoded<typeof entrySchema>;
const _entryToSchema: Hyperlink.Decoded<typeof entrySchema> = hEntry;
const _entryToType: QueueEntry<Hyperlink.Decoded<typeof EmailJob>> = sEntry;

// ── QueueEvent<T, E, A> ⇄ queueEvent(item, { success, error }).Type ──────────────
declare const hEvent: QueueEvent<Hyperlink.Decoded<typeof EmailJob>, string, number>;
declare const sEvent: Hyperlink.Decoded<typeof eventSchema>;
const _eventToSchema: Hyperlink.Decoded<typeof eventSchema> = hEvent;
const _eventToType: QueueEvent<Hyperlink.Decoded<typeof EmailJob>, string, number> = sEvent;

void [
  _metricsToSchema,
  _metricsToType,
  _releaseToSchema,
  _releaseToType,
  _entryToSchema,
  _entryToType,
  _eventToSchema,
  _eventToType,
];
