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

const clientsRest = Node.clients(Worker, Jobs, Emails);
void clientsRest;

const clientsArr = Node.clients(Worker, [Jobs, Emails]);
void clientsArr;

// @ts-expect-error C3: clients must cover Emails
const clientsPartial = Node.clients(Worker, Jobs);
void clientsPartial;

// @ts-expect-error C3: array form must cover Emails
const clientsPartialArr = Node.clients(Worker, [Jobs]);
void clientsPartialArr;

class BoundJobs extends Resource.Tag<BoundJobs>()("listen-d/BoundJobs", {
  jobs: Resource.effect(Schema.Number),
}).pipe(Resource.andNode(Worker)) {}

class BoundEmails extends Resource.Tag<BoundEmails>()("listen-d/BoundEmails", {
  emails: Resource.effect(Schema.String),
}).pipe(Resource.andNode(Worker)) {}

const clientsBoundRest = Node.clients(BoundJobs, BoundEmails);
void clientsBoundRest;

const clientsBoundArr = Node.clients([BoundJobs, BoundEmails]);
void clientsBoundArr;
