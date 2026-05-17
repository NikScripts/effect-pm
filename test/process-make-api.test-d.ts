import { Effect } from "effect";
import { Process } from "../src";

// @ts-expect-error Process.make requires (id, config)
Process.make({ name: "legacy", effect: Effect.void });

// @ts-expect-error second argument (config) is required
Process.make("@app/OnlyId");

const _valid = Process.make("@app/Valid", { effect: Effect.void });

void _valid;
