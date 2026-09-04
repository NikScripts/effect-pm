import type { Layer } from "effect";
import * as Lookup from "../src/Lookup";
import * as Node from "../src/Node";

// Lookup.follow / followOptions — same Services + LookupUnaddressed as client.

const lookupNode = Node.Service()("lookup-follow-d/Lookup", {
  path: "/tmp/lookup-follow-d.sock",
}).pipe(Node.asLookup);

const follow: Layer.Layer<Lookup.Services, Lookup.LookupUnaddressed> =
  Lookup.follow(lookupNode);

const followOpts: Layer.Layer<Lookup.Services, Lookup.LookupUnaddressed> =
  Lookup.followOptions({ path: "/tmp/lookup-follow.sock" });

const clientParity: Layer.Layer<Lookup.Services, Lookup.LookupUnaddressed> =
  Lookup.client(lookupNode);

const unaddressed: Layer.Layer<Lookup.Services, Lookup.LookupUnaddressed> =
  Lookup.follow(Node.Service()("lookup-follow-d/NoPath"));

void follow;
void followOpts;
void clientParity;
void unaddressed;
