import { Schema } from "effect";
import * as Process from "../src/Process";

type HasEventsOnSpec = "events" extends keyof typeof Process.processSpec ? true : false;
true satisfies HasEventsOnSpec;

const FetchError = Schema.TaggedStruct("FetchError", { status: Schema.Number });
const typedSpec = Process.buildProcessSpec(undefined, FetchError);

type HasEventsOnBuilt = "events" extends keyof typeof typedSpec ? true : false;
true satisfies HasEventsOnBuilt;
