# Command authentication recipe

## Goal

Design command authentication for the effect-pm control plane so every accepted
control-plane communication is signed correctly before it reaches command
routing.

## Non-goals

- Scope and permission policy.
- Per-command authorization.
- Durable audit storage.
- Non-HTTP transports beyond preserving a transport-neutral auth model.

## Mise en place findings

- `ControlService` is currently localhost-only and explicitly unauthenticated.
- `ControlProtocolRequestEnvelope` already carries `id`, `sentAt`, optional
  metadata, and the typed `request`, which is the right payload boundary for
  signing.
- `ControlTransportHttp` has two surfaces: protocol envelopes at `POST /control`
  and REST shortcuts that translate into the same protocol request model.
- `ProcessManager` centralizes typed remote calls through protocol envelopes.

## Locked ingredients

- Scope and permission checks are future work.
- Every control-plane communication must be rejected unless it has a valid
  signature.
- Authentication sits before `ControlRouter.handle`, so process and queue
  semantics stay unchanged.
- V1 uses per-receiver public key enrollment. The PM and each direct group
  endpoint own their accepted public key records.
- V1 does not ship a master key. One locally generated key may be enrolled with
  many receivers, but each enrollment is explicit.
- PM tooling should automate public key enrollment for groups where it has local
  write access and print install instructions for remote groups.
- V1 signs canonical JSON `{ version, method, path, envelope }` and carries the
  signature in `Effect-PM-Signature`.
- V1 uses signed timestamp skew plus an in-memory `{ keyId, envelope.id }`
  replay cache, with an optional replay-store interface for stronger receivers.
- V1 ships as one coherent implementation slice: public `CommandAuth`, internal
  crypto/canonical/replay helpers, strict signed `POST /control`, signed
  `GetHealth`, admin keygen, PM enrollment helpers, focused tests/docs, and a
  changeset.

## Open recipe steps

- Signature primitive and key format.
- Trust topology and key enrollment.
- Canonical signing payload and HTTP header.
- Replay protection shape.
- V1 implementation slice, test matrix, docs, and changeset.
- Implementation order and review cuts.

## Step 1: Signature primitive and key format

Recipe step: `Signature primitive and key format`

What this decides:
The primitive determines what secrets the server must hold and how operators,
child endpoints, and CI clients authenticate commands.

Recommended ingredients:
- `Ed25519` asymmetric signatures — the server stores public keys only, clients
  hold private keys, and future authorization can attach policy to `keyId`
  without rotating shared server secrets.
- `keyId` in the signature header — lets the server select a public key and later
  gives the authorization layer a natural principal identifier.
- `name` and `expiresAt` in the public key record — operators can generate a key
  with a human label and an expiration date without introducing permissions yet.
- Private keys as local env values or local files — the CLI prints or writes the
  private key only on the machine that generated it.
- Node `crypto.sign` / `crypto.verify` under a small `CommandAuth` abstraction —
  keeps the public API algorithm-aware while keeping transport code simple.

Picture:

```sh
# Admin CLI: local-only private material.
effect-pm auth keygen --name nik-laptop --expires 2026-12-31

# stdout, shown once:
EFFECT_PM_COMMAND_KEY_ID=cmd_01jz...
EFFECT_PM_COMMAND_PRIVATE_KEY='-----BEGIN PRIVATE KEY-----...'

# public registration record, safe to copy to a group / PM config:
{
  "keyId": "cmd_01jz...",
  "name": "nik-laptop",
  "algorithm": "Ed25519",
  "expiresAt": "2026-12-31T23:59:59.999Z",
  "publicKey": "-----BEGIN PUBLIC KEY-----..."
}
```

```ts
// Server public API: direct group endpoint.
const commandAuth = CommandAuth.ed25519Verifier({
  keys: Config.array(CommandAuth.PublicKeyRecordConfig)(
    "EFFECT_PM_COMMAND_PUBLIC_KEYS",
  ),
});

ControlService.layerHttp(BillingGroup, {
  port: 3001,
  auth: commandAuth,
});
```

```ts
// Client public API: ProcessManager / operator command signer.
const client = CommandAuth.ed25519Signer({
  keyId: "ops-laptop-01",
  privateKey: Config.redacted("EFFECT_PM_COMMAND_PRIVATE_KEY"),
});

const manager = ProcessManager.connect(BillingGroup, {
  baseUrl: "http://127.0.0.1:3001",
  auth: client,
});
```

```ts
// Internal transport: sign the envelope before HTTP.
const signEnvelope = (
  envelope: ControlProtocolRequestEnvelope,
): Effect.Effect<CommandAuthHeader, CommandAuthError, CommandAuthSigner> =>
  Effect.gen(function* () {
    const signer = yield* CommandAuthSigner;
    const payload = yield* CommandAuth.canonicalPayload({
      method: "POST",
      path: "/control",
      envelope,
    });
    return yield* signer.sign(payload);
  });
```

```ts
// Internal server gate: reject before ControlRouter.handle.
const authenticateRequest = (
  envelope: ControlProtocolRequestEnvelope,
  header: string | undefined,
): Effect.Effect<void, CommandAuthError, CommandAuthVerifier> =>
  Effect.gen(function* () {
    const verifier = yield* CommandAuthVerifier;
    const payload = yield* CommandAuth.canonicalPayload({
      method: "POST",
      path: "/control",
      envelope,
    });
    yield* verifier.verify({ header, payload, now: yield* Clock.currentTimeMillis });
  });
```

```ts
// Test shape: bad signatures never route.
const routed = yield* Ref.make(false);
const router = {
  handle: () => Ref.set(routed, true).pipe(Effect.as(successProtocolResponse)),
};

const response = yield* postControl({ signature: "bad" });

expect(response.status).toBe(401);
expect(yield* Ref.get(routed)).toBe(false);
```

```http
POST /control
Effect-PM-Signature: v1; alg=Ed25519; keyId=cmd_01jz...; signature=...
Content-Type: application/json

{
  "id": "control-...",
  "sentAt": 1780330000000,
  "request": { "_tag": "RunProcessImmediately", "processId": "@app/Billing/Sync" }
}
```

Alternatives:
1. `HMAC-SHA256` — simplest local setup, but every verifier also has signing
   power because the server stores the shared secret.
2. `Pluggable verifier first, no built-in algorithm` — flexible, but makes the
   first shipped feature harder to adopt and test end-to-end.

Question:
Should the first baked implementation target `Ed25519` as the built-in command
signature primitive?

Recommended answer:
Yes. It matches the word "signature" precisely, keeps private material off the
server, and gives us a clean `keyId` principal for future permissions without
adding permissions now.

Acceptance check:
A server configured with one public key accepts a command signed by the matching
private key and rejects missing, malformed, unknown-key, and invalid-signature
requests before `ControlRouter.handle` runs.

## Alternatives and rejected substitutions

- Authorization scopes in v1 are rejected for this recipe; the only v1 decision
  is whether the communication is signed correctly.

## Step 2: Trust topology and key enrollment

Recipe step: `Trust topology and key enrollment`

What this decides:
Commands can target the ProcessManager operator surface or direct group control
endpoints. This step decides whether one key should unlock everything or whether
keys are enrolled per command receiver.

Recommended ingredients:
- Per-receiver public key registries — each PM instance and each group endpoint
  accepts only the public keys configured for that receiver.
- PM-assisted enrollment — the PM CLI can discover groups and help install or
  print per-group public key records, but the group still verifies its own
  incoming commands.
- No master key in v1 — a single private key that can command every group and the
  PM is too broad before permissions exist.
- Shared generated key material is allowed by operator choice — the same local
  private key may be registered with many groups, but that is explicit enrollment
  rather than implicit global trust.

Picture:

```sh
# Generate one local operator key. Private key is only emitted locally.
effect-pm auth keygen --name nik-laptop --expires 2026-12-31 \
  --private-key-out ~/.config/effect-pm/keys/nik-laptop.pem \
  --public-record-out ~/.config/effect-pm/keys/nik-laptop.public.json
```

```sh
# PM/operator CLI helper: print group-specific config snippets.
pm auth enroll-key ./nik-laptop.public.json --group @app/Billing
pm auth enroll-key ./nik-laptop.public.json --all-groups --dry-run
```

```ts
// Direct group: group owns the verifier for direct commands.
ControlService.layerHttp(BillingGroup, {
  port: 3001,
  auth: CommandAuth.ed25519Verifier({
    keys: Config.array(CommandAuth.PublicKeyRecordConfig)(
      "BILLING_GROUP_COMMAND_KEYS",
    ),
  }),
});
```

```ts
// ProcessManager: PM owns the verifier for commands sent to PM itself.
ProcessManager.layerHttp({
  auth: CommandAuth.ed25519Verifier({
    keys: Config.array(CommandAuth.PublicKeyRecordConfig)(
      "EFFECT_PM_COMMAND_KEYS",
    ),
  }),
});
```

```ts
// PM automation model: discover groups, but preserve group-local trust roots.
const enrollOperatorKey = (
  publicRecord: CommandAuth.PublicKeyRecord,
  targets: ReadonlyArray<ProcessManagerGroupConfig>,
) =>
  Effect.forEach(targets, (target) =>
    target.endpoint._tag === "ProcessManagerChildEndpoint"
      ? writeLocalGroupEnv(target, publicRecord)
      : printRemoteInstallInstructions(target, publicRecord),
  );
```

Alternatives:
1. Master key accepted by PM and every group — very convenient, but a leaked key
   controls everything while v1 has no permissions.
2. PM-only command path — centralizes auth, but breaks the existing direct group
   `ControlService` use case and creates an unnecessary runtime dependency.
3. Per-command generated keys — safer in theory, but this recreates permissions
   and policy before the project wants that feature.

Question:
Should v1 use per-receiver key enrollment, with PM tooling that helps register
the same local public key with selected groups, instead of a master key?

Decision:
Yes. Per-receiver enrollment is locked for v1; no global master key.

Recommended answer:
Yes. It keeps the blast radius bounded without introducing scopes, and it still
lets the PM CLI automate the boring parts of configuring every group.

Acceptance check:
A key registered with the PM but not a group can command the PM only; a key
registered with a group can command that group directly; PM helper commands can
generate or print the per-group env/config needed to enroll a public key.

## Step 3: Canonical signing payload and HTTP header

Recipe step: `Canonical signing payload and HTTP header`

What this decides:
The signature must cover the same bytes on every client and server, and the HTTP
adapter needs a stable place to carry key identity and signature bytes.

Recommended ingredients:
- Canonical JSON payload — encode a small structured object with sorted object
  keys, no whitespace, and no transport-specific headers.
- Method, path, envelope id, envelope sent time, metadata, and request — binds
  the signature to the exact command and HTTP route.
- `Effect-PM-Signature` header — carries version, algorithm, key id, and
  signature without modifying the existing protocol envelope schema.
- `sentAt` stays inside the signed envelope — timestamp validation and replay
  detection use a field already present in `ControlProtocolRequestEnvelope`.

Picture:

```ts
// Public shape: envelope stays protocol-owned; auth rides beside it.
export interface CommandAuthSigningInput {
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly envelope: ControlProtocolRequestEnvelope;
}

export interface CommandAuthSignatureHeader {
  readonly version: "v1";
  readonly algorithm: "Ed25519";
  readonly keyId: string;
  readonly signature: string;
}
```

```ts
// Canonical payload, before UTF-8 encoding and Ed25519 signing.
const payload = CommandAuth.canonicalPayload({
  method: "POST",
  path: "/control",
  envelope: {
    id: "control-1780330000000-1",
    sentAt: 1780330000000,
    metadata: { actor: "nik", reason: "manual catch-up" },
    request: {
      _tag: "RunProcessImmediately",
      processId: "@app/Billing/SyncInvoices",
    },
  },
});
```

```json
{"envelope":{"id":"control-1780330000000-1","metadata":{"actor":"nik","reason":"manual catch-up"},"request":{"_tag":"RunProcessImmediately","processId":"@app/Billing/SyncInvoices"},"sentAt":1780330000000},"method":"POST","path":"/control","version":"effect-pm-command-auth-v1"}
```

```http
POST /control
Content-Type: application/json
Effect-PM-Signature: v1; alg=Ed25519; keyId=cmd_01jz...; signature=base64url...
```

```ts
// Internal HTTP client hook.
const request = HttpClientRequest.post(joinUrl(config.baseUrl, "/control")).pipe(
  (req) => HttpClientRequest.bodyJson(req, envelope),
  Effect.flatMap((req) =>
    signer.sign({
      method: "POST",
      path: "/control",
      envelope,
    }).pipe(Effect.map((header) => HttpClientRequest.setHeader(
      req,
      "Effect-PM-Signature",
      CommandAuth.formatSignatureHeader(header),
    ))),
  ),
);
```

```ts
// Internal HTTP server gate.
const envelope = yield* readControlEnvelope(req);
const signature = req.headers["effect-pm-signature"];
yield* verifier.verify({
  header: signature,
  input: { method: "POST", path: "/control", envelope },
});
const protocolResponse = yield* router.handle(envelope.request);
```

Alternatives:
1. Sign raw HTTP body bytes — simple for `/control`, but brittle around JSON
   serialization and awkward for REST shortcuts.
2. Put signature fields inside `ControlProtocolRequestEnvelope` — transport
   neutral, but mixes authentication mechanics into the command protocol and
   forces in-memory/custom transports to model HTTP auth details.
3. Sign only `request` — smaller payload, but misses route binding, request id,
   metadata, and replay timestamp.

Question:
Should v1 sign a canonical JSON object of `{ version, method, path, envelope }`
and carry the signature in `Effect-PM-Signature`?

Decision:
Yes. V1 signs canonical JSON `{ version, method, path, envelope }`; HTTP carries
the detached signature in `Effect-PM-Signature`.

Recommended answer:
Yes. It keeps the protocol envelope stable, covers enough context to prevent
route or payload substitution, and leaves custom transports free to pass auth
beside the command envelope.

Acceptance check:
Two clients signing the same logical command produce the same canonical payload;
changing method, path, envelope id, `sentAt`, metadata, or request invalidates
the signature.

## Step 4: Replay protection shape

Recipe step: `Replay protection shape`

What this decides:
A valid signature proves who signed the command, but not whether the same command
was captured and resent. This step decides the minimum replay defense before
future durable audit or permissions exist.

Recommended ingredients:
- Short skew window on signed `envelope.sentAt` — reject commands too far in the
  past or future before checking replay storage.
- In-memory replay cache keyed by `{ keyId, envelope.id }` — enough for one
  running receiver process without adding persistence.
- Optional external replay store interface — lets long-running PM deployments or
  clustered receivers plug in durable/shared replay tracking later.
- Replay insert is part of verification — only the verifier decides whether an
  id is newly accepted, so route handlers never see replay bookkeeping.

Picture:

```ts
// Public configuration.
const auth = CommandAuth.ed25519Verifier({
  keys: Config.array(CommandAuth.PublicKeyRecordConfig)(
    "BILLING_GROUP_COMMAND_KEYS",
  ),
  replay: CommandAuth.Replay.memory({
    window: Duration.minutes(5),
    maxEntries: 10_000,
  }),
});
```

```ts
// Public extension point for PMs that need shared replay state.
export interface CommandAuthReplayStore {
  readonly reserve: (
    input: {
      readonly keyId: string;
      readonly envelopeId: string;
      readonly sentAt: number;
      readonly expiresAt: number;
    },
  ) => Effect.Effect<void, CommandAuthReplayError>;
}
```

```ts
// Internal verifier flow.
const verifySignedCommand = (input: VerifyInput) =>
  Effect.gen(function* () {
    const header = yield* parseSignatureHeader(input.header);
    const key = yield* keyring.publicKey(header.keyId);
    yield* assertNotExpired(key, input.now);
    yield* assertWithinSkew(input.envelope.sentAt, input.now, config.window);
    yield* verifyEd25519Signature(key.publicKey, input.payload, header.signature);
    yield* replayStore.reserve({
      keyId: header.keyId,
      envelopeId: input.envelope.id,
      sentAt: input.envelope.sentAt,
      expiresAt: input.envelope.sentAt + Duration.toMillis(config.window),
    });
  });
```

```ts
// Test shape.
yield* signedClient.process(SyncProcess.id).runImmediately;
const replay = yield* postSameEnvelopeAgain().pipe(Effect.flip);

expect(replay.status).toBe(401);
expect(replay.reason).toContain("replayed command");
expect(yield* Ref.get(runs)).toBe(1);
```

Alternatives:
1. Timestamp-only replay defense — stateless and simple, but an attacker can
   replay within the accepted skew window.
2. Durable replay store in v1 — stronger across restarts and multiple receivers,
   but it drags persistence into the first auth slice.
3. Monotonic sequence numbers per key — robust, but hard for multiple clients
   using the same key and awkward with retries.

Question:
Should v1 use signed timestamp skew plus an in-memory `{ keyId, envelope.id }`
replay cache, with an optional replay-store interface for stronger deployments?

Decision:
Yes. V1 uses signed timestamp skew plus an in-memory replay cache by default;
shared/durable replay tracking is an extension point, not a v1 requirement.

Recommended answer:
Yes. It prevents ordinary capture-and-replay attacks without forcing storage
into v1, and it leaves a clean path for PM or clustered deployments that need
shared replay state.

Acceptance check:
The first valid command id for a key succeeds; reusing the same envelope id with
the same key fails; stale and far-future `sentAt` values fail even with valid
signatures.

## Step 5: V1 implementation slice

Recipe step: `V1 implementation slice`

What this decides:
This bundles the remaining v1 shape into one shippable slice: public API,
transport wiring, CLI key lifecycle, strict HTTP coverage, errors,
observability, tests, docs, and release bookkeeping. It does not reopen the
locked cryptography, enrollment, canonical payload, or replay decisions.

Recommended ingredients:
- `src/CommandAuth.ts` public module and `@nikscripts/effect-pm/CommandAuth`
  subpath — command auth is app-composed public behavior, not internal plumbing.
- `src/internal/commandAuth/*` helpers — canonical JSON, base64url, header
  parse/format, PEM key parsing, Ed25519 crypto calls, and in-memory replay
  storage stay internal.
- Strict authenticated HTTP mode — when `auth` is configured, `POST /control`
  is the only command/control route; REST shortcuts, `/health`, and log streams
  fail unsigned before routing.
- Protocol-owned health command — add `GetHealth` to `ControlProtocolRequest`
  so liveness can be checked through the same signed envelope as other reads.
- Admin key CLI in `effect-pm auth keygen` — generates Ed25519 key pairs locally,
  writes private key only to stdout or an explicit local path, and emits the
  public registration record with `name` and `expiresAt`.
- PM helper commands in `ProcessManager.cli` — assist enrollment by printing or
  writing public key records for direct group endpoints where config is local;
  remote groups get copy/paste instructions.
- Typed auth failures — map missing, malformed, expired, replayed, and invalid
  signatures to `401`; never let auth failures look like process or queue
  failures.
- Focused tests and docs — test crypto primitives, canonical payload stability,
  verifier rejection cases, strict HTTP behavior, signed `ProcessManager`
  commands, CLI keygen output, and direct group vs PM enrollment.
- Changeset — required when the plan ships because it adds public API,
  documented behavior, exports, and operator CLI commands.

Picture:

```ts
// package.json exports
{
  "exports": {
    "./CommandAuth": {
      "types": "./dist/CommandAuth.d.ts",
      "import": "./dist/CommandAuth.mjs",
      "require": "./dist/CommandAuth.js"
    }
  }
}
```

```ts
// src/CommandAuth.ts public surface.
export class CommandAuthVerifier extends Context.Service<CommandAuthVerifier>()(
  "@nikscripts/effect-pm/CommandAuth/Verifier",
)<{
  readonly verify: (
    input: CommandAuthVerifyInput,
  ) => Effect.Effect<void, CommandAuthError>;
}>() {}

export class CommandAuthSigner extends Context.Service<CommandAuthSigner>()(
  "@nikscripts/effect-pm/CommandAuth/Signer",
)<{
  readonly sign: (
    input: CommandAuthSigningInput,
  ) => Effect.Effect<CommandAuthSignatureHeader, CommandAuthError>;
}>() {}

export const CommandAuth = {
  ed25519Signer,
  ed25519Verifier,
  canonicalPayload,
  formatSignatureHeader,
  parseSignatureHeader,
  Replay,
  Schema: {
    PublicKeyRecord: PublicKeyRecordSchema,
  },
} as const;
```

```ts
// src/internal/commandAuth/canonical.ts
export const canonicalPayload = (
  input: CommandAuthSigningInput,
): Effect.Effect<Uint8Array, CommandAuthError> =>
  stableJsonEncode({
    version: "effect-pm-command-auth-v1",
    method: input.method,
    path: input.path,
    envelope: input.envelope,
  }).pipe(Effect.map((text) => new TextEncoder().encode(text)));
```

```ts
// Direct group receiver, strict by construction when auth is present.
ControlService.layerHttp(BillingGroup, {
  port: 3001,
  auth: CommandAuth.ed25519Verifier({
    keys: Config.array(CommandAuth.Schema.PublicKeyRecord)(
      "BILLING_GROUP_COMMAND_KEYS",
    ),
    replay: CommandAuth.Replay.memory({
      window: Duration.minutes(5),
      maxEntries: 10_000,
    }),
  }),
});
```

```ts
// HTTP server branch: auth gate before router.handle.
if (authEnabled && req.method !== "OPTIONS" && url.pathname !== "/control") {
  yield* writeJson(
    res,
    404,
    errorResponse("Authenticated control services accept signed POST /control only"),
  );
  return;
}

if (url.pathname === "/control") {
  const envelope = yield* readControlEnvelope(req);
  yield* verifier.verify({
    header: readSignatureHeader(req.headers),
    input: { method: "POST", path: "/control", envelope },
  });
  const protocolResponse = yield* router.handle(envelope.request);
  yield* writeProtocolEnvelope(res, envelope, protocolResponse);
}
```

```ts
// Health through the signed protocol instead of unsigned GET /health.
export type ControlProtocolRequest =
  | { readonly _tag: "GetHealth" }
  | { readonly _tag: "GetContract" }
  | { readonly _tag: "ReadGroupStatus" }
  // ...

case "GetHealth":
  return {
    _tag: "Control",
    status: 200,
    body: { success: true, data: { status: "ok" } },
  };
```

```sh
# Admin CLI: generate local private material and safe public record.
effect-pm auth keygen \
  --name nik-laptop \
  --expires 2026-12-31 \
  --private-key-out ~/.config/effect-pm/keys/nik-laptop.pem \
  --public-record-out ~/.config/effect-pm/keys/nik-laptop.public.json
```

```sh
# PM CLI helper: one local key can be explicitly enrolled into selected groups.
pm auth enroll-key ~/.config/effect-pm/keys/nik-laptop.public.json \
  --group @app/Billing \
  --write-env .env.local
```

```ts
// Test matrix sketch.
it("rejects unsigned control before routing", () => rejectsBeforeRouter());
it("rejects malformed signature headers", () => rejectsBeforeRouter());
it("rejects expired public keys", () => rejectsBeforeRouter());
it("rejects replayed envelope ids", () => rejectsBeforeRouter());
it("runs a signed ProcessManager command once", () => runsOnce());
it("disables REST shortcuts when auth is configured", () => shortcut404s());
it("uses signed GetHealth in authenticated mode", () => signedHealthOk());
it("generates key records with name and expiration", () => keygenRecordOk());
```

Why this recommendation is good:
- It is secure: no unsigned control path remains once auth is enabled.
- It is clean: one signed protocol path carries all control operations.
- It is straightforward: public auth composition lives in `CommandAuth`; HTTP
  transport only signs/verifies; process and queue routing stay untouched.
- It matches repo boundaries: public app-composed API under `src/`, type-agnostic
  helpers under `src/internal/`, and operator commands in the existing bin/PM CLI.

Alternatives:
1. Implement strict HTTP first, defer CLI keygen/enrollment — smaller code diff,
   but the feature is awkward to adopt because users must hand-roll keys.
2. Keep signed REST shortcuts in v1 — friendlier to curl, but creates a second
   signing shape and doubles the route test matrix.
3. Add durable replay/audit in v1 — stronger for clustered deployments, but it
   mixes persistence design into the first auth slice.
4. Make `CommandAuth` internal only — fewer public exports, but apps need to
   compose signers/verifiers, so hiding it fights the package architecture.

Question:
Should v1 ship as this full implementation slice: public `CommandAuth`, internal
crypto/canonical/replay helpers, strict signed `POST /control`, signed
`GetHealth`, admin keygen, PM enrollment helpers, focused tests/docs, and a
changeset?

Decision:
Yes. V1 ships as the full coherent implementation slice, not a partial strict
HTTP-only feature that leaves key generation or enrollment for users to invent.

Recommended answer:
Yes. This is the smallest slice that is secure, clean, straightforward, and
usable without making users invent key-management glue outside the package.

Acceptance check:
An app can generate a local key, enroll its public record into a direct group,
run signed PM/group commands, reject every unsigned or replayed control attempt
before routing, check signed health, and pass focused unit/integration tests plus
`pnpm run typecheck`, `pnpm test`, `pnpm run lint`, and `pnpm run build`.

## Step 6: Implementation order and review cuts

Recipe step: `Implementation order and review cuts`

What this decides:
The v1 slice is big enough to benefit from reviewable commits, but the commits
must still land in an order where each one compiles and proves something useful.

Recommended ingredients:
- Cut 1: `CommandAuth` core — public types, schemas, canonical payload,
  Ed25519 signing/verifying, header format, in-memory replay, and unit tests.
- Cut 2: control transport integration — `ControlProtocol.GetHealth`,
  `ControlTransportHttp` strict auth gate, `ProcessManager.connect` signer
  plumbing, and integration tests for signed commands and unsigned rejection.
- Cut 3: operator ergonomics — `effect-pm auth keygen`, PM enrollment helper
  commands, docs/examples, package export/build wiring, and changeset.
- Keep old no-auth behavior explicit — existing users keep current behavior
  until they configure `auth`.
- Run standard checks at the end of every cut that touches code, with the full
  suite before final PR summary.

Picture:

```txt
commit 1: CommandAuth core
  src/CommandAuth.ts
  src/internal/commandAuth/{base64url,canonical,ed25519,headers,replay}.ts
  test/command-auth.test.ts

commit 2: signed control transport
  src/ControlProtocol.ts
  src/ControlTransportHttp.ts
  src/ControlService.ts
  src/ProcessManager.ts
  test/control-auth.test.ts

commit 3: operator workflow
  src/bin/effect-pm.ts
  src/ProcessManager.ts
  docs/guides/control-plane.md
  docs/guides/process-manager.md
  package.json
  .changeset/*.md
```

```ts
// Cut 1 acceptance: no HTTP involved.
const keypair = yield* CommandAuth.generateEd25519KeyPair({
  name: "nik-laptop",
  expiresAt: "2026-12-31T23:59:59.999Z",
});
const header = yield* signer.sign({ method: "POST", path: "/control", envelope });
yield* verifier.verify({ header, input: { method: "POST", path: "/control", envelope } });
```

```ts
// Cut 2 acceptance: signed PM command reaches router once.
yield* signedManager.process(SyncProcess.id).runImmediately;
const replay = yield* postSameEnvelopeAgain().pipe(Effect.flip);

expect(yield* Ref.get(runs)).toBe(1);
expect(replay.status).toBe(401);
```

```sh
# Cut 3 acceptance: generated private material stays local.
effect-pm auth keygen \
  --name nik-laptop \
  --expires 2026-12-31 \
  --private-key-out ~/.config/effect-pm/keys/nik-laptop.pem \
  --public-record-out ./nik-laptop.public.json

pm auth enroll-key ./nik-laptop.public.json --group @app/Billing --dry-run
```

```sh
# Final verification.
pnpm run typecheck
pnpm test
pnpm run lint
pnpm run build
```

Why this recommendation is good:
- It reduces risk without splitting the feature into unusable fragments.
- It lets crypto correctness stabilize before HTTP and CLI code depend on it.
- It keeps review focused: core auth, transport behavior, then operator UX.

Alternatives:
1. One large implementation commit — fastest mechanically, but harder to review
   and debug when a test fails.
2. Ship strict HTTP before CLI keygen — smaller first diff, but fails the
   "straightforward" goal because users must make keys manually.
3. Build CLI first — good demo value, but it creates command surfaces before the
   verifier and transport contract are proven.

Question:
Should implementation proceed in these three review cuts: `CommandAuth` core,
signed control transport, then operator workflow/docs/changeset?

Recommended answer:
Yes. It is the quickest path that still keeps each commit testable, reviewable,
and useful.

Acceptance check:
Each cut compiles and has targeted tests; the final cut passes typecheck, tests,
lint, and build, and includes the required changeset.

## Cleanup status

- Working recipe; remove or promote into durable docs once the design ships.
