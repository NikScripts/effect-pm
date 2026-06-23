import { Schema } from "effect";
import { queueEntry } from "../src/QueueContract";
import type { QueueEntry } from "../src/QueueResource";

// ───────────────────────────────────────────────────────────────────────────
// Drift guard for the single cast in `QueueResource.layer`'s `enqueue` adapter.
//
// That adapter casts the decoded wire entry (`queueEntry(itemSchema).Type`) to the engine's
// `QueueEntry<T>` because effect Schema's `.Type` goes opaque over an abstract item schema and
// the two can't be statically related there. They ARE the same shape — and these assertions
// prove it at concrete instantiations. If the wire `queueEntry` schema and the engine
// `QueueEntry` interface ever diverge, one of these fails to compile and the build breaks,
// surfacing the drift instead of letting the cast hide it.
//
// The non-`item` fields are item-independent, and `item` is `Sch["Type"]` on both sides, so a
// couple of concrete item types are representative of all of them.
// ───────────────────────────────────────────────────────────────────────────

type Assert<T extends true> = T;
type IsAssignable<A, B> = [A] extends [B] ? true : false;

const _numberEntry = queueEntry(Schema.Number);
type NumberWireEntry = typeof _numberEntry.Type;

const _structEntry = queueEntry(
  Schema.Struct({ id: Schema.String, n: Schema.Number }),
);
type StructWireEntry = typeof _structEntry.Type;

// the cast direction: wire decoded entry must be assignable to the engine entry.
const _castSoundNumber: Assert<IsAssignable<NumberWireEntry, QueueEntry<number>>> = true;
const _castSoundStruct: Assert<
  IsAssignable<StructWireEntry, QueueEntry<{ readonly id: string; readonly n: number }>>
> = true;

// reverse direction (engine → wire, the events/release output path) — full structural equality.
const _outputSoundNumber: Assert<IsAssignable<QueueEntry<number>, NumberWireEntry>> = true;
const _outputSoundStruct: Assert<
  IsAssignable<QueueEntry<{ readonly id: string; readonly n: number }>, StructWireEntry>
> = true;

void _castSoundNumber;
void _castSoundStruct;
void _outputSoundNumber;
void _outputSoundStruct;
