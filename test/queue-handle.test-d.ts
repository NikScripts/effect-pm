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

// ── threaded guard: the cast is now over `QueueInstanceSpec<F, Success, Error>` ──────────────────
// nameQueueService asserts `ServiceOf<QueueInstanceSpec<F, Success, Error>>` ⇄
// `QueueResource<Decoded<F>, Success["Type"], Error["Type"], never>`. Prove it for concrete slots.
type ContractSE = Resource.ShapeOf<
  ReturnType<typeof queueSpec<F, typeof Schema.Number, typeof Schema.String>>
>;
type HandleSE = QueueResource.QueueResource<
  Resource.Decoded<typeof EmailJob>,
  number,
  string
>;
declare const contractSE: ContractSE;
declare const handleSE: HandleSE;
const _seHandleToContract: ContractSE = handleSE;
const _seContractToHandle: HandleSE = contractSE;
void [_seHandleToContract, _seContractToHandle];

// ── DoD #4: a payload-only tag hovers/types as `QueueResource<Payload, void, never, never>` ─────
type Exact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const assertExact = <_ extends true>(): void => {};
assertExact<
  Exact<
    Resource.Shape<typeof Emails>,
    QueueResource.QueueResource<Resource.Decoded<typeof EmailJob>, void, never, never>
  >
>();

// ── DoD #4: a tag declaring `error` surfaces that error type on the named handle (Error param,
// which flows into `events`' `Cause<E>`). A tag declaring `success` surfaces it likewise. ───────────
class Failing extends QueueResource.Tag<Failing>()("test/queue-handle/Failing", {
  payload: EmailJob,
  success: Schema.Number,
  error: Schema.String,
}) {}
assertExact<
  Exact<
    Resource.Shape<typeof Failing>,
    QueueResource.QueueResource<Resource.Decoded<typeof EmailJob>, number, string, never>
  >
>();
