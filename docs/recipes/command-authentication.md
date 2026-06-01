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
- Implementation proceeds in three cuts: `CommandAuth` core, signed control
  transport, then operator workflow/docs/changeset.
- Cut 1 includes the public `CommandAuth` export and package subpath.
- Signed `GetHealth` ships in Cut 2 as protocol/transport behavior.
- `effect-pm auth keygen` and `pm auth enroll-key` land together in Cut 3.
- The changeset lands in Cut 3.
- Cut 1 uses separate `CommandAuthSigner` and `CommandAuthVerifier` services.
- Cut 1 key records use PEM strings plus `name`, `keyId`, `algorithm`, and
  `expiresAt`.
- `generateEd25519KeyPair` is public in `CommandAuth`.
- `canonicalPayload` is public for custom signer/verifier tests.
- Auth failures are separate tagged error classes.
- Cut 2 adds signed `GetHealth` to `ControlProtocolRequest`.
- Cut 2 disables REST shortcuts, unsigned `/health`, and unsigned log streaming
  whenever `auth` is configured.
- Cut 2 configures auth through explicit client/server config fields.
- Cut 2 maps auth failures to `401 ControlTransportError` before routing.
- Cut 2 tests assert router/process code does not run on auth failure.
- Cut 3 keygen outputs private key material only to stdout or explicit local
  paths.
- Cut 3 keygen emits both dotenv snippets and JSON public key records.
- Cut 3 `pm auth enroll-key` is a local helper, not a remote mutation command.
- Cut 3 enrollment supports `--dry-run`, `--group`, `--all-groups`, and
  `--write-env`.
- Cut 3 includes docs, examples, and the changeset.

## Open recipe steps

- Signature primitive and key format.
- Trust topology and key enrollment.
- Canonical signing payload and HTTP header.
- Replay protection shape.
- V1 implementation slice, test matrix, docs, and changeset.
- Implementation order and review cuts.
- Cut 1 `CommandAuth` API details.
- Cut 2 signed control transport details.
- Cut 3 operator workflow details.

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

Decision steps:
1. Should implementation proceed in these three review cuts: `CommandAuth` core,
   signed control transport, then operator workflow/docs/changeset? —
   **Recommended answer:** Yes; this keeps each commit testable and reviewable.
2. Should Cut 1 include the public `CommandAuth` export and package subpath, or
   keep it test-only until transport integration? — **Recommended answer:** Put
   it in Cut 1 so all later code consumes the real public API.
3. Should signed `GetHealth` ship in Cut 2 as part of protocol/transport, or wait
   for operator docs in Cut 3? — **Recommended answer:** Ship it in Cut 2 because
   it is protocol behavior, not documentation.
4. Should `effect-pm auth keygen` and `pm auth enroll-key` land together in Cut
   3, or should keygen land first with enrollment docs only? —
   **Recommended answer:** Land them together so operator setup is usable
   end-to-end.
5. Should the changeset be part of Cut 3, or held until the recipe is promoted
   into durable docs and code? — **Recommended answer:** Include it in Cut 3
   because the implementation adds public API, behavior, exports, and CLI
   commands.

Decision:
Yes to all five implementation-order steps.

Ingredients:
Yes to the three cuts. Put the public export in Cut 1 so all later code consumes
the real API. Put signed `GetHealth` in Cut 2 because it is a protocol behavior,
not operator documentation. Land keygen and enrollment together in Cut 3 so the
operator workflow is usable end-to-end. Include the changeset in Cut 3 because
the implementation introduces public API, behavior, exports, and CLI commands.

Acceptance check:
Each cut compiles and has targeted tests; the final cut passes typecheck, tests,
lint, and build, and includes the required changeset.

## Step 7: Cut 1 `CommandAuth` API details

Recipe step: `Cut 1 CommandAuth API details`

What this decides:
The core module is the foundation for later transport and CLI cuts. This step
decides the exact public names, data shapes, error model, and test fixtures for
the first implementation cut.

Recommended ingredients:
- `CommandAuth` namespace export plus short exports for service tags and errors
  — matches package public-export conventions.
- `CommandAuthSigner` and `CommandAuthVerifier` services — lets transports use
  DI and keeps custom signers/verifiers possible.
- `PublicKeyRecord` / `PrivateKeyRecord` schemas — keygen, env config, and tests
  share one typed shape.
- `CommandAuthError` tagged union — missing/malformed/expired/replay/invalid
  failures are typed and map cleanly to HTTP `401` later.
- `generateEd25519KeyPair` in public API — keygen CLI and tests use package code
  instead of duplicating crypto logic.
- `canonicalPayload` is public but deterministic and narrow — apps can test
  custom signers, while implementation remains small.
- Unit tests use fixed key fixtures and generated keys — fixed fixtures prove
  deterministic payload/signature behavior; generated keys prove runtime Node
  crypto wiring.

Picture:

```ts
// src/CommandAuth.ts
export interface PublicKeyRecord {
  readonly keyId: string;
  readonly name: string;
  readonly algorithm: "Ed25519";
  readonly publicKeyPem: string;
  readonly expiresAt: string;
}

export interface PrivateKeyRecord {
  readonly keyId: string;
  readonly name: string;
  readonly algorithm: "Ed25519";
  readonly privateKeyPem: string;
  readonly expiresAt: string;
}
```

```ts
export type CommandAuthError =
  | MissingSignatureHeader
  | MalformedSignatureHeader
  | UnknownKeyId
  | ExpiredKey
  | SignatureVerificationFailed
  | ReplayedCommand
  | CanonicalPayloadError
  | KeyMaterialError;
```

```ts
export interface CommandAuthSigningInput {
  readonly method: "POST";
  readonly path: "/control";
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
export class CommandAuthSigner extends Context.Service<CommandAuthSigner>()(
  "@nikscripts/effect-pm/CommandAuth/Signer",
)<{
  readonly sign: (
    input: CommandAuthSigningInput,
  ) => Effect.Effect<CommandAuthSignatureHeader, CommandAuthError>;
}>() {}

export class CommandAuthVerifier extends Context.Service<CommandAuthVerifier>()(
  "@nikscripts/effect-pm/CommandAuth/Verifier",
)<{
  readonly verify: (
    input: {
      readonly header: string | CommandAuthSignatureHeader | undefined;
      readonly input: CommandAuthSigningInput;
      readonly now?: number;
    },
  ) => Effect.Effect<void, CommandAuthError>;
}>() {}
```

```ts
export const CommandAuth = {
  generateEd25519KeyPair,
  ed25519Signer,
  ed25519Verifier,
  canonicalPayload,
  formatSignatureHeader,
  parseSignatureHeader,
  Replay: {
    memory: makeMemoryReplayStore,
  },
  Schema: {
    PublicKeyRecord: PublicKeyRecordSchema,
    PrivateKeyRecord: PrivateKeyRecordSchema,
  },
  Errors: {
    MissingSignatureHeader,
    MalformedSignatureHeader,
    UnknownKeyId,
    ExpiredKey,
    SignatureVerificationFailed,
    ReplayedCommand,
    CanonicalPayloadError,
    KeyMaterialError,
  },
} as const;
```

```ts
// test/command-auth.test.ts
it("round trips a generated Ed25519 command signature", () =>
  Effect.gen(function* () {
    const keys = yield* CommandAuth.generateEd25519KeyPair({
      name: "nik-laptop",
      expiresAt: "2026-12-31T23:59:59.999Z",
    });
    const signer = CommandAuth.ed25519Signer(keys.privateKey);
    const verifier = CommandAuth.ed25519Verifier({
      keys: [keys.publicKey],
      replay: CommandAuth.Replay.memory({ window: Duration.minutes(5) }),
    });

    const header = yield* signer.sign(signingInput);
    yield* verifier.verify({ header, input: signingInput, now: signingInput.envelope.sentAt });
  }));
```

```ts
it("rejects replayed envelope ids", () =>
  Effect.gen(function* () {
    const header = yield* signer.sign(signingInput);

    yield* verifier.verify({ header, input: signingInput });
    const error = yield* verifier.verify({ header, input: signingInput }).pipe(Effect.flip);

    expect(error._tag).toBe("ReplayedCommand");
  }));
```

Alternatives:
1. Single `CommandAuthService` instead of signer/verifier services — simpler
   names, but transports need one side at a time and tests become less direct.
2. Keep key generation internal to the CLI — less public API, but tests and
   custom tooling duplicate crypto/key record logic.
3. Make `canonicalPayload` internal — smaller API, but custom signers cannot
   verify exactly what the package signs.
4. Use one generic `CommandAuthError` with `reason` only — less code, but weaker
   tests and less precise HTTP mapping.

Decision steps:
1. Should Cut 1 use separate `CommandAuthSigner` and `CommandAuthVerifier`
   services? — **Recommended answer:** Yes; transports need one side at a time
   and custom signers/verifiers stay easy.
2. Should key records use PEM strings plus `name`, `keyId`, `algorithm`, and
   `expiresAt`? — **Recommended answer:** Yes; this is easy to store in env,
   files, and JSON records.
3. Should `generateEd25519KeyPair` be public in `CommandAuth`? —
   **Recommended answer:** Yes; CLI and tests should use package code, not
   duplicate crypto.
4. Should `canonicalPayload` be public for custom signer/verifier tests? —
   **Recommended answer:** Yes; custom integrations must be able to sign exactly
   what the package verifies.
5. Should auth failures be separate tagged error classes instead of one generic
   reason string? — **Recommended answer:** Yes; typed failures make tests and
   HTTP mapping precise.

Decision:
Yes to all five Cut 1 API steps.

Ingredients:
Yes to all five. This gives strong type surfaces, keeps transport wiring simple,
and avoids duplicating crypto/key-generation logic in CLI code and tests.

Acceptance check:
Cut 1 exports compile through root and subpath imports, fixed and generated
Ed25519 tests pass, canonical payload snapshots are stable, replay rejection is
typed, and no HTTP transport files are required for the tests.

## Step 8: Cut 2 signed control transport details

Recipe step: `Cut 2 signed control transport details`

What this decides:
Cut 2 wires the already-tested `CommandAuth` core into the control protocol,
HTTP adapter, and `ProcessManager` client path without pulling in operator CLI
key-management work yet.

Recommended ingredients:
- Add `GetHealth` to `ControlProtocolRequest` — health becomes a signed protocol
  command instead of a special unauthenticated HTTP shortcut.
- Keep no-auth behavior as the default when no `auth` is configured — existing
  localhost users do not break until they opt in.
- When `auth` is configured, strict mode disables REST shortcuts, unsigned
  `/health`, and unsigned log streaming — every accepted communication is signed.
- Add `auth?: CommandAuthVerifier.Type` to server config and
  `auth?: CommandAuthSigner.Type` to client/manager config — no global mutable
  auth state.
- `ControlTransportHttp.client` signs envelopes immediately before HTTP body
  send; `ControlTransportHttp.server` verifies immediately after envelope decode
  and before `router.handle`.
- Map `CommandAuthError` to `ControlTransportError` with HTTP `401` — auth
  failures are transport failures, not process/queue failures.
- Tests must prove auth rejection does not route — use a `Ref<boolean>` or
  process run counter to verify router/process code never runs.

Picture:

```ts
// src/ControlProtocol.ts
export type ControlProtocolRequest =
  | { readonly _tag: "GetHealth" }
  | { readonly _tag: "GetContract" }
  | { readonly _tag: "ReadGroupStatus" }
  | { readonly _tag: "RunProcessImmediately"; readonly processId: string }
  // ...
```

```ts
// src/ControlProtocol.ts router case
case "GetHealth":
  return {
    _tag: "Control",
    status: 200,
    body: {
      success: true,
      data: { status: "ok" },
    },
  };
```

```ts
// src/ControlTransportHttp.ts
export interface ControlTransportHttpClientConfig {
  readonly baseUrl: string;
  readonly auth?: CommandAuthSigner.Type;
}

export interface ControlTransportHttpServerConfig {
  readonly port?: number;
  readonly auth?: CommandAuthVerifier.Type;
}
```

```ts
// client signing path
const request = HttpClientRequest.post(joinUrl(config.baseUrl, "/control")).pipe(
  (req) => HttpClientRequest.bodyJson(req, envelope),
  Effect.flatMap((req) =>
    config.auth === undefined
      ? Effect.succeed(req)
      : config.auth.sign({ method: "POST", path: "/control", envelope }).pipe(
          Effect.map((header) =>
            HttpClientRequest.setHeader(
              req,
              "Effect-PM-Signature",
              CommandAuth.formatSignatureHeader(header),
            ),
          ),
        ),
  ),
);
```

```ts
// server verification path
if (req.method === "POST" && url.pathname === "/control") {
  const envelope = yield* readControlEnvelope(req);

  if (config.auth !== undefined) {
    yield* config.auth.verify({
      header: readSignatureHeader(req),
      input: { method: "POST", path: "/control", envelope },
    }).pipe(
      Effect.mapError((error) => transportError(commandAuthErrorMessage(error), 401)),
    );
  }

  const protocolResponse = yield* router.handle(envelope.request);
  yield* writeProtocolEnvelope(res, envelope, protocolResponse);
}
```

```ts
// strict authenticated mode
if (config.auth !== undefined && url.pathname !== "/control") {
  yield* writeJson(
    res,
    404,
    errorResponse("Authenticated control services accept signed POST /control only"),
  );
  return;
}
```

```ts
// ProcessManager API
const manager = ProcessManager.connect(BillingGroup, {
  baseUrl: "http://127.0.0.1:3001",
  auth: CommandAuth.ed25519Signer(privateKeyRecord),
});
```

```ts
// test/control-auth.test.ts
it.live("rejects unsigned control before routing", () =>
  Effect.gen(function* () {
    const runs = yield* Ref.make(0);
    const unsigned = ProcessManager.connect(BillingGroup, {
      baseUrl: "http://127.0.0.1:32150",
    });

    const error = yield* unsigned.process(SyncProcess.id).runImmediately.pipe(Effect.flip);

    expect(error.status).toBe(401);
    expect(yield* Ref.get(runs)).toBe(0);
  }));
```

```ts
it.live("runs a signed command exactly once and rejects replay", () =>
  Effect.gen(function* () {
    yield* signed.process(SyncProcess.id).runImmediately;
    const replay = yield* postSameEnvelopeAgain().pipe(Effect.flip);

    expect(replay.status).toBe(401);
    expect(yield* Ref.get(runs)).toBe(1);
  }));
```

Alternatives:
1. Preserve signed REST shortcuts in Cut 2 — keeps old curl ergonomics, but adds a
   second signing path and slows the secure default.
2. Keep `/health` outside auth — simpler liveness probes, but violates the
   locked invariant that accepted communication is signed.
3. Provide signer/verifier through Effect context only — idiomatic, but config
   object support is easier for `ProcessManager.connect` and tests.
4. Map auth failures into normal `ControlResponse` bodies with `success: false`
   — simpler shape, but hides transport authentication failures as command
   failures.

Decision steps:
1. Should `GetHealth` be added to `ControlProtocolRequest` in Cut 2? —
   **Recommended answer:** Yes; health should be signed through the same protocol
   as other reads.
2. Should strict mode disable REST shortcuts, unsigned `/health`, and unsigned log
   streaming whenever `auth` is configured? — **Recommended answer:** Yes; this
   preserves the locked invariant and keeps the rule simple.
3. Should auth be configured through explicit client/server config fields rather
   than global context only? — **Recommended answer:** Yes; config fields are
   straightforward for HTTP and `ProcessManager.connect`.
4. Should auth failures map to `401 ControlTransportError` before routing? —
   **Recommended answer:** Yes; authentication is transport-level failure.
5. Should Cut 2 tests assert router/process code does not run on auth failure? —
   **Recommended answer:** Yes; that is the main security acceptance condition.

Decision:
Yes to all five Cut 2 transport steps.

Ingredients:
Yes to all five. Cut 2 should make signed `/control` the only authenticated
communication path, keep no-auth behavior opt-in compatible, and prove failed
auth never reaches routing.

Acceptance check:
Signed `ProcessManager` commands work, unsigned/malformed/expired/replayed
requests return `401`, REST shortcuts and unsigned health/log routes are disabled
when auth is configured, signed `GetHealth` succeeds, and test counters prove
failed auth never invokes router/process logic.

## Step 9: Cut 3 operator workflow details

Recipe step: `Cut 3 operator workflow details`

What this decides:
Cut 3 makes the signed command system usable by operators. It wires local key
generation, public-key enrollment assistance, documentation, examples, package
exports/build config, and release notes without changing the already-tested core
auth or transport semantics.

Recommended ingredients:
- `effect-pm auth keygen` writes private material only to stdout or an explicit
  local path — no accidental repository writes.
- Keygen emits both dotenv snippets and a JSON public key record — env-first apps
  and config-file apps both get a clean path.
- `pm auth enroll-key` is a ProcessManager CLI helper, not a direct remote write
  protocol — v1 has no authorization or remote config mutation system.
- Enrollment helper supports `--dry-run`, `--group`, `--all-groups`,
  `--write-env <path>`, and copy/paste output — automation where local config is
  available, instructions where it is not.
- Docs update `control-plane.md` and `process-manager.md` with secure setup,
  direct group setup, PM setup, rotation, expiration, and troubleshooting.
- Examples include one direct group and one PM-managed multi-group setup.
- Changeset ships in this cut because public API, package exports, behavior, and
  CLI commands are now present.

Picture:

```sh
# Generate local private material and public registration record.
effect-pm auth keygen \
  --name nik-laptop \
  --expires 2026-12-31 \
  --private-key-out ~/.config/effect-pm/keys/nik-laptop.pem \
  --public-record-out ~/.config/effect-pm/keys/nik-laptop.public.json
```

```dotenv
# Private, local-only signer env.
EFFECT_PM_COMMAND_KEY_ID=cmd_01jz8w3t...
EFFECT_PM_COMMAND_PRIVATE_KEY_FILE=/home/nik/.config/effect-pm/keys/nik-laptop.pem
```

```json
{
  "keyId": "cmd_01jz8w3t...",
  "name": "nik-laptop",
  "algorithm": "Ed25519",
  "expiresAt": "2026-12-31T23:59:59.999Z",
  "publicKeyPem": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n"
}
```

```sh
# Print install snippets for one group.
pm auth enroll-key ~/.config/effect-pm/keys/nik-laptop.public.json \
  --group @app/Billing \
  --dry-run
```

```dotenv
# Public verifier env for @app/Billing.
BILLING_GROUP_COMMAND_KEYS='[
  {
    "keyId": "cmd_01jz8w3t...",
    "name": "nik-laptop",
    "algorithm": "Ed25519",
    "expiresAt": "2026-12-31T23:59:59.999Z",
    "publicKeyPem": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n"
  }
]'
```

```ts
// Direct group app setup.
ControlService.layerHttp(BillingGroup, {
  port: 3001,
  auth: CommandAuth.ed25519Verifier({
    keys: Config.array(CommandAuth.Schema.PublicKeyRecord)(
      "BILLING_GROUP_COMMAND_KEYS",
    ),
    replay: CommandAuth.Replay.memory({ window: Duration.minutes(5) }),
  }),
});
```

```ts
// Operator CLI setup.
const signer = CommandAuth.ed25519SignerFromConfig({
  keyId: Config.string("EFFECT_PM_COMMAND_KEY_ID"),
  privateKeyFile: Config.string("EFFECT_PM_COMMAND_PRIVATE_KEY_FILE"),
});

const cli = ProcessManager.cli([BillingGroup] as const, {
  auth: signer,
});
```

```md
Troubleshooting docs:
- 401 MissingSignatureHeader: configure signer on the CLI/client.
- 401 UnknownKeyId: enroll the public key with this group/PM receiver.
- 401 ExpiredKey: generate a replacement key and remove the expired record.
- 401 ReplayedCommand: retry with a fresh command envelope.
- 404 strict mode shortcut: use signed POST /control or ProcessManager CLI.
```

```md
Changeset:
---
"@nikscripts/effect-pm": minor
---

Adds signed command authentication for ProcessManager and ControlService,
including CommandAuth APIs, strict signed control transport, key generation, and
operator enrollment helpers.
```

Alternatives:
1. Keygen only, enrollment later — simpler CLI work, but operators still have to
   hand-build verifier env values.
2. Enrollment writes remote config over the control plane — attractive long term,
   but v1 has no permissions or config mutation protocol.
3. Store private keys in project `.env` by default — convenient, but makes
   accidental commits more likely; explicit local path is safer.
4. Docs only, no examples — faster, but this feature needs copy/pasteable setup
   because mistakes become auth failures.

Decision steps:
1. Should `effect-pm auth keygen` output private key material only to stdout or
   explicit local paths? — **Recommended answer:** Yes; never write secrets into
   the repo implicitly.
2. Should keygen emit both dotenv snippets and JSON public records? —
   **Recommended answer:** Yes; it supports env-based and file/config-based apps.
3. Should `pm auth enroll-key` be a local helper that prints/writes config, not a
   remote mutation command? — **Recommended answer:** Yes; remote mutation needs
   future permissions.
4. Should enrollment support `--dry-run`, `--group`, `--all-groups`, and
   `--write-env`? — **Recommended answer:** Yes; those cover safe preview,
   targeted setup, bulk setup, and local automation.
5. Should Cut 3 include docs, examples, and the changeset? —
   **Recommended answer:** Yes; the feature is public and operationally sensitive.

Decision:
Yes to all five Cut 3 operator workflow steps.

Ingredients:
Yes to all five. Cut 3 should complete the operator path without creating remote
config mutation or unsafe secret storage.

Acceptance check:
An operator can generate a local private key, enroll the public key into one or
more group verifier configs, run signed PM commands using env/file signer config,
diagnose common auth failures from docs, run direct and PM examples, and review a
changeset describing the public API/behavior change.

## Cleanup status

- Implementation-ready recipe; keep as the agent memory ledger until the design
  ships, then promote durable behavior into docs and remove this recipe in a
  cleanup commit.
