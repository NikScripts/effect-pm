import { Effect, Schema } from "effect";
import type { Layer } from "effect";
import * as Resource from "../src/Resource";
import * as Node from "../src/Node";

// C2/C3 — listen requires the full ROut; partial omit is a type error.
// Specs must differ structurally — identical shapes collapse Jobs | Emails in TS.

class Jobs extends Resource.Tag<Jobs>()("listen-d/Jobs", {
  jobs: Resource.effect(Schema.Number),
}) {}

class Emails extends Resource.Tag<Emails>()("listen-d/Emails", {
  emails: Resource.effect(Schema.String),
}) {}

class Worker extends Node.Tag<Worker, Jobs | Emails>()("listen-d/Worker", {
  path: "/tmp/listen-d.sock",
}) {}

const jobsImpl = { jobs: Effect.succeed(1) };
const emailsImpl = { emails: Effect.succeed("ok") };

const full: Layer.Layer<any, any, any> = Node.unix(Worker, [
  Resource.serve(Jobs, jobsImpl),
  Resource.serve(Emails, emailsImpl),
]);

// @ts-expect-error C3: Emails missing from listen catalog
const partial: Layer.Layer<any, any, any> = Node.unix(Worker, [
  Resource.serve(Jobs, jobsImpl),
]);

void full;
void partial;

const clients = Node.clientsFor(Worker, Jobs, Emails);
void clients;

// @ts-expect-error C3: clientsFor must cover Emails
const clientsPartial = Node.clientsFor(Worker, Jobs);
void clientsPartial;
