import { Schema } from "effect";
import * as WorkPool from "../src/WorkPool";

const Job = Schema.Struct({ id: Schema.String });
const Summary = Schema.Struct({ words: Schema.Number });

class _PositionalPayload extends WorkPool.Tag<_PositionalPayload>()("@app/Q", Job) {}

class _PositionalWire extends WorkPool.Tag<_PositionalWire>()("@app/Q", Job, Summary) {}

// @ts-expect-error — config object requires `payload`
class _MissingPayload extends WorkPool.Tag<_MissingPayload>()("@app/Q", { success: Summary }) {}

void _PositionalPayload;
void _PositionalWire;
