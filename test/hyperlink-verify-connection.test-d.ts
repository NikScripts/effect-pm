/**
 * Type-level lock: tier-1 `verifyConnection` stays on `NodeUnreachable | UnaddressedNode`;
 * `{ deep: true }` widens to the classification errors. Call-site overload resolution (not
 * `typeof` Extract) is what pins the channels.
 */
import type { Effect } from "effect";
import type {
  AnyNode,
  ContractMismatch,
  NodeUnreachable,
  ProtocolUnanswered,
  ServiceNotReady,
  ServiceNotServed,
  UnaddressedNode,
} from "../src/Node";
import { verifyConnection } from "../src/Hyperlink";

type ErrOf<T> = T extends Effect.Effect<infer _A, infer E, infer _R> ? E : never;
type AssertExact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

function typeLock(node: AnyNode): void {
  const tier1 = verifyConnection(node);
  const deep = verifyConnection(node, {
    deep: true,
    serviceKey: "app/X",
    contractHash: "deadbeef",
  });

  type Tier1Err = ErrOf<typeof tier1>;
  type DeepErr = ErrOf<typeof deep>;

  const _tier1: AssertExact<Tier1Err, NodeUnreachable | UnaddressedNode> = true;
  const _deepHasProtocol: ProtocolUnanswered extends DeepErr ? true : false = true;
  const _deepHasServed: ServiceNotServed extends DeepErr ? true : false = true;
  const _deepHasReady: ServiceNotReady extends DeepErr ? true : false = true;
  const _deepHasHash: ContractMismatch extends DeepErr ? true : false = true;
  const _tier1LacksProtocol: ProtocolUnanswered extends Tier1Err ? false : true = true;

  void _tier1;
  void _deepHasProtocol;
  void _deepHasServed;
  void _deepHasReady;
  void _deepHasHash;
  void _tier1LacksProtocol;
  void tier1;
  void deep;
}
void typeLock;
