import type { Layer } from "effect";
import type * as Lookup from "../src/Lookup";
import * as Resource from "../src/Resource";

// D4 — lookupClient options: bare fail-closed; pick is "first" | sync DirectoryEntry fn.

class Jobs extends Resource.Tag<Jobs>()("lookup-pick-d/Jobs", {}) {}

const bare: Layer.Layer<
  Jobs,
  Resource.LookupClientError,
  Lookup.Services
> = Resource.lookupClient(Jobs);

const first: Layer.Layer<
  Jobs,
  Resource.LookupClientError,
  Lookup.Services
> = Resource.lookupClient(Jobs, { pick: "first" });

const custom: Layer.Layer<
  Jobs,
  Resource.LookupClientError,
  Lookup.Services
> = Resource.lookupClient(Jobs, {
  pick: (rows) => rows[0]!,
});

// @ts-expect-error pick must be "first" or a DirectoryEntry picker
const bad = Resource.lookupClient(Jobs, { pick: "random" });

void bare;
void first;
void custom;
void bad;
