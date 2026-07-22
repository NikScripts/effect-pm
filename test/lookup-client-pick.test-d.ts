import type { Layer } from "effect";
import type * as Lookup from "../src/Lookup";
import * as Hyperlink from "../src/Hyperlink";

// D4 — lookupClient options: bare fail-closed; pick is "first" | sync DirectoryEntry fn.

class Jobs extends Hyperlink.Tag<Jobs>()("lookup-pick-d/Jobs", {}) {}

const bare: Layer.Layer<
  Jobs,
  Hyperlink.LookupClientError,
  Lookup.Services
> = Hyperlink.lookupClient(Jobs);

const first: Layer.Layer<
  Jobs,
  Hyperlink.LookupClientError,
  Lookup.Services
> = Hyperlink.lookupClient(Jobs, { pick: "first" });

const custom: Layer.Layer<
  Jobs,
  Hyperlink.LookupClientError,
  Lookup.Services
> = Hyperlink.lookupClient(Jobs, {
  pick: (rows) => rows[0]!,
});

// @ts-expect-error pick must be "first" or a DirectoryEntry picker
const bad = Hyperlink.lookupClient(Jobs, { pick: "random" });

void bare;
void first;
void custom;
void bad;
