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

## Open recipe steps

- Signature primitive and key format.
- Trust topology and key enrollment.
- Canonical signing payload and HTTP header.
- Replay protection shape.
- REST shortcut policy under mandatory auth.
- Tests and docs.

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

Recommended answer:
Yes. It keeps the protocol envelope stable, covers enough context to prevent
route or payload substitution, and leaves custom transports free to pass auth
beside the command envelope.

Acceptance check:
Two clients signing the same logical command produce the same canonical payload;
changing method, path, envelope id, `sentAt`, metadata, or request invalidates
the signature.

## Cleanup status

- Working recipe; remove or promote into durable docs once the design ships.
