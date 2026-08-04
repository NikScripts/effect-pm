/**
 * {@link Hyperlink.unix} overloads — Node path dial vs Tag Lookup discover.
 */
import type { Layer } from "effect";
import { Schema } from "effect";
import * as Hyperlink from "../src/Hyperlink";
import * as Node from "../src/Node";

class Jobs extends Hyperlink.Service<Jobs>()("unix-d/Jobs", {
  jobs: Hyperlink.effect(Schema.Number),
}) {}

class Worker extends Node.Service<Worker>()("unix-d/Worker", {
  path: "/tmp/unix-d.sock",
}) {}

const byTag: Layer.Layer<Jobs, Hyperlink.LookupClientError> = Hyperlink.unix(Jobs);
const byTagOpts: Layer.Layer<Jobs, Hyperlink.LookupClientError> = Hyperlink.unix(
  Jobs,
  { pick: "first", lookupPath: "/tmp/lookup.sock" },
);
const byNode: Layer.Layer<Worker, Node.UnaddressedNode> = Hyperlink.unix(Worker);

// @ts-expect-error discoverClient was folded into unix(tag)
void Hyperlink.discoverClient;

void byTag;
void byTagOpts;
void byNode;
