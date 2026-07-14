import { Schema } from "effect";
import * as QueueResource from "../src/QueueResource";
import { queueSpec } from "../src/QueueResource";
import * as Resource from "../src/Resource";

// ── The soundness guard for the ONE cast in `nameQueueService` ───────────────
// `yield* MyQueue` is asserted to be `QueueResource<Decoded<F>>`; that assertion is only sound if
// the named handle is bidirectionally equal to the raw contract `ServiceOf<QueueInstanceSpec<F>>`.
// TS can't prove that for generic `F` (invariant service Shape), so we prove it here for a concrete
// representative `F`. If the shapes ever drift, THIS FAILS THE BUILD — which is what licenses the cast.

const EmailJob = Schema.Struct({ to: Schema.String });
type F = typeof EmailJob.fields;

// the raw contract the tag actually carries, pre-cast:
type Contract = Resource.ShapeOf<ReturnType<typeof queueSpec<F>>>;
// the named handle the tag is asserted to expose:
type Handle = QueueResource.QueueResource<Resource.Decoded<typeof EmailJob>>;

declare const contract: Contract;
declare const handle: Handle;

// bidirectional — direct assignments, no casts. Either failing = the assertion is unsound.
const _handleToContract: Contract = handle;
const _contractToHandle: Handle = contract;
void [_handleToContract, _contractToHandle];

// and confirm the naming actually took effect: `yield* Emails` (= Shape<Emails>) IS the named handle.
class Emails extends QueueResource.Tag<Emails>()("test/queue-handle/Emails", {
  payload: EmailJob,
}) {}
declare const emailsService: Resource.Shape<typeof Emails>;
const _yieldToHandle: Handle = emailsService;
const _handleToYield: Resource.Shape<typeof Emails> = handle;
void [_yieldToHandle, _handleToYield];
