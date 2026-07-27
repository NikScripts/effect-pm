/**
 * Type-level lock: loud-failure tagged errors keep stable `_tag` + field shapes so Exit /
 * CatchTag remediation stays dependable.
 * Runtime coverage: `resource-missing-client-protocol.test.ts`, `transport-conformance.test.ts`,
 * `resource-identity.test.ts`, `lookup-advice.test.ts`.
 */
import {
  IdentityMultiNode,
  IdentitySelfRequired,
  LookupClientError,
  MissingClientProtocol,
  ProtocolMismatch,
} from "../src/Hyperlink";

type AssertExact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

const missing = new MissingClientProtocol({ resource: "app/Probe" });
const mismatch = new ProtocolMismatch({
  resource: "app/Probe",
  method: "ping",
  cause: undefined,
});
const identitySelf = new IdentitySelfRequired({ tag: "app/Mail" });
const identityMulti = new IdentityMultiNode({ tag: "app/Mail", nodeCount: 2 });
const lookupMissing = new LookupClientError({
  tag: "app/Worker",
  reason: "missing",
  count: 0,
});
const lookupAmbiguous = new LookupClientError({
  tag: "app/Worker",
  reason: "ambiguous",
  count: 3,
});

true satisfies AssertExact<typeof missing._tag, "MissingClientProtocol">;
true satisfies AssertExact<typeof mismatch._tag, "ProtocolMismatch">;
true satisfies AssertExact<typeof identitySelf._tag, "IdentitySelfRequired">;
true satisfies AssertExact<typeof identityMulti._tag, "IdentityMultiNode">;
true satisfies AssertExact<typeof lookupMissing._tag, "LookupClientError">;
true satisfies AssertExact<typeof lookupAmbiguous._tag, "LookupClientError">;

void (missing.resource satisfies string);
void (mismatch.resource satisfies string);
void (mismatch.method satisfies string);
void (mismatch.cause satisfies unknown);
void (identitySelf.tag satisfies string);
void (identityMulti.tag satisfies string);
void (identityMulti.nodeCount satisfies number);
void (lookupMissing.tag satisfies string);
void (lookupMissing.reason satisfies "missing" | "ambiguous");
void (lookupMissing.count satisfies number);

// Constructor arg shapes — forbid silent field renames / drops.
new MissingClientProtocol({ resource: "x" });
new ProtocolMismatch({ resource: "x", method: "y", cause: "z" });
new IdentitySelfRequired({ tag: "x" });
new IdentityMultiNode({ tag: "x", nodeCount: 2 });
new LookupClientError({ tag: "x", reason: "missing", count: 0 });

// @ts-expect-error - resource is required
new MissingClientProtocol({});

// @ts-expect-error - method is required
new ProtocolMismatch({ resource: "x", cause: undefined });

// @ts-expect-error - tag is required
new IdentitySelfRequired({});

// @ts-expect-error - reason must be the closed union
new LookupClientError({ tag: "x", reason: "other", count: 1 });
