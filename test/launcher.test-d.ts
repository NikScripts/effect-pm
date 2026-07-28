/**
 * Type-level lock: Launcher.spawn / up and Node.assume error channels.
 */
import type { Effect, Redacted, Scope } from "effect";
import type { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import type * as Launcher from "../src/Launcher";
import type {
  AssumeNotReady,
  AssumeTokenMismatch,
  AssumeTokenReused,
  AnyNode,
  NodeUnreachable,
  UnaddressedNode,
} from "../src/Node";
import { assume } from "../src/Node";

type ErrOf<T> = T extends Effect.Effect<infer _A, infer E, infer _R> ? E : never;
type ReqOf<T> = T extends Effect.Effect<infer _A, infer _E, infer R> ? R : never;
type AssertExtends<A, B> = [A] extends [B] ? true : false;

function typeLock(
  node: AnyNode,
  command: ChildProcess.Command,
  spawn: typeof Launcher.spawn,
  up: typeof Launcher.up,
  mintToken: typeof Launcher.mintToken,
): void {
  type MintSuccess = typeof mintToken extends Effect.Effect<
    infer A,
    infer _E,
    infer _R
  >
    ? A
    : never;
  const _mintIsRedacted: AssertExtends<MintSuccess, Redacted.Redacted<string>> =
    true;

  const spawned = spawn({ node, process: command });
  type SpawnReq = ReqOf<typeof spawned>;
  const _spawnNeedsSpawner: AssertExtends<
    ChildProcessSpawner.ChildProcessSpawner,
    SpawnReq
  > = true;
  const _spawnNeedsScope: AssertExtends<Scope.Scope, SpawnReq> = true;

  const upped = up({ node, process: command });
  type UpErr = ErrOf<typeof upped>;
  const _upHasReadyTimedOut: AssertExtends<Launcher.ReadyTimedOut, UpErr> =
    true;
  const _upHasChildExited: AssertExtends<Launcher.ChildExited, UpErr> = true;
  const _upHasHandleNotReady: AssertExtends<Launcher.HandleNotReady, UpErr> =
    true;
  const _upHasHandleSpent: AssertExtends<Launcher.HandleSpent, UpErr> = true;
  const _upHasAssume: AssertExtends<AssumeTokenMismatch, UpErr> = true;

  const assumed = assume(node, { token: "x" });
  type AssumeErr = ErrOf<typeof assumed>;
  const _assumeMismatch: AssertExtends<AssumeTokenMismatch, AssumeErr> = true;
  const _assumeReuse: AssertExtends<AssumeTokenReused, AssumeErr> = true;
  const _assumeNotReady: AssertExtends<AssumeNotReady, AssumeErr> = true;
  const _assumeUnreachable: AssertExtends<NodeUnreachable, AssumeErr> = true;
  const _assumeUnaddressed: AssertExtends<UnaddressedNode, AssumeErr> = true;

  void _mintIsRedacted;
  void _spawnNeedsSpawner;
  void _spawnNeedsScope;
  void _upHasReadyTimedOut;
  void _upHasChildExited;
  void _upHasHandleNotReady;
  void _upHasHandleSpent;
  void _upHasAssume;
  void _assumeMismatch;
  void _assumeReuse;
  void _assumeNotReady;
  void _assumeUnreachable;
  void _assumeUnaddressed;
  void spawned;
  void upped;
  void assumed;
  void mintToken;
}
void typeLock;
