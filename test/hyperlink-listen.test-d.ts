import { Effect, Schema } from "effect";
import type { Layer } from "effect";
import * as Hyperlink from "../src/Hyperlink";
import * as Node from "../src/Node";

// C2/C3 — listen requires the full ROut; partial omit is a type error.
// Specs must differ structurally — identical shapes collapse Jobs | Emails in TS.

class Jobs extends Hyperlink.Service<Jobs>()("listen-d/Jobs", {
  jobs: Hyperlink.effect(Schema.Number),
}) {}

class Emails extends Hyperlink.Service<Emails>()("listen-d/Emails", {
  emails: Hyperlink.effect(Schema.String),
}) {}

class Worker extends Node.Service<Worker, Jobs | Emails>()("listen-d/Worker", {
  path: "/tmp/listen-d.sock",
}) {}

const jobsImpl = { jobs: Effect.succeed(1) };
const emailsImpl = { emails: Effect.succeed("ok") };

const full: Layer.Any = Node.unix(Worker, [
  Hyperlink.serve(Jobs, jobsImpl),
  Hyperlink.serve(Emails, emailsImpl),
]);
void full;

// Statement form — avoids `missingLayerContext` on a `Layer.Any` annotation.
// @ts-expect-error C3: Emails missing from listen catalog
Node.unix(Worker, [Hyperlink.serve(Jobs, jobsImpl)]);

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

class BoundJobs extends Hyperlink.Service<BoundJobs>()("listen-d/BoundJobs", {
  jobs: Hyperlink.effect(Schema.Number),
}).pipe(Hyperlink.andNode(Worker)) {}

class BoundEmails extends Hyperlink.Service<BoundEmails>()("listen-d/BoundEmails", {
  emails: Hyperlink.effect(Schema.String),
}).pipe(Hyperlink.andNode(Worker)) {}

const clientsBoundRest = Node.clients(BoundJobs, BoundEmails);
void clientsBoundRest;

const clientsBoundArr = Node.clients([BoundJobs, BoundEmails]);
void clientsBoundArr;
