/**
 * Type-level lock: loud-failure tagged errors keep stable `_tag` + field shapes so Exit /
 * CatchTag remediation stays dependable (MissingClientProtocol, ProtocolMismatch).
 * Runtime coverage: `resource-missing-client-protocol.test.ts`, `transport-conformance.test.ts`.
 */
import {
  MissingClientProtocol,
  ProtocolMismatch,
} from "../src/Resource";

type AssertExact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

const missing = new MissingClientProtocol({ resource: "app/Probe" });
const mismatch = new ProtocolMismatch({
  resource: "app/Probe",
  method: "ping",
  cause: undefined,
});

true satisfies AssertExact<typeof missing._tag, "MissingClientProtocol">;
true satisfies AssertExact<typeof mismatch._tag, "ProtocolMismatch">;

void (missing.resource satisfies string);
void (mismatch.resource satisfies string);
void (mismatch.method satisfies string);
void (mismatch.cause satisfies unknown);

// Constructor arg shapes — forbid silent field renames / drops.
new MissingClientProtocol({ resource: "x" });
new ProtocolMismatch({ resource: "x", method: "y", cause: "z" });

// @ts-expect-error - resource is required
new MissingClientProtocol({});

// @ts-expect-error - method is required
new ProtocolMismatch({ resource: "x", cause: undefined });
