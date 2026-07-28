/**
 * Type-level lock: Launcher.spawn / up / Handle channels, Token brand, Config split.
 */
import type { Config, Duration, Effect, Layer, Redacted, Scope } from "effect";
import type { ConfigError } from "effect/Config";
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
type AssertNotExtends<A, B> = [A] extends [B] ? false : true;

function typeLock(
  node: AnyNode,
  command: ChildProcess.Command,
  spawn: typeof Launcher.spawn,
  up: typeof Launcher.up,
  mintToken: typeof Launcher.mintToken,
  readyTimeoutConfig: typeof Launcher.readyTimeoutConfig,
  readyPollConfig: typeof Launcher.readyPollConfig,
  commandFactory: typeof Launcher.command,
  entryFactory: typeof Launcher.entry,
  layer: typeof Launcher.layer,
  handle: Launcher.Handle,
  jobs: { readonly key: string },
): void {
  type MintSuccess = typeof mintToken extends Effect.Effect<
    infer A,
    infer _E,
    infer _R
  >
    ? A
    : never;
  const _mintIsRedactedToken: AssertExtends<
    MintSuccess,
    Redacted.Redacted<Launcher.Token>
  > = true;
  const _handleTokenBrand: AssertExtends<
    typeof handle.token,
    Redacted.Redacted<Launcher.Token>
  > = true;

  const _readyTimeoutIsConfig: AssertExtends<
    typeof readyTimeoutConfig,
    Config.Config<Duration.Duration>
  > = true;
  const _readyPollIsConfig: AssertExtends<
    typeof readyPollConfig,
    Config.Config<Duration.Duration>
  > = true;

  const processFactory = commandFactory("node", ["./worker.js"]);
  const _processIsFactory: AssertExtends<
    typeof processFactory,
    (token: string) => ChildProcess.Command
  > = true;

  const entryBuilt = entryFactory("./worker.js");
  const _entryIsFactory: AssertExtends<
    typeof entryBuilt,
    (token: string) => ChildProcess.Command
  > = true;

  type LayerServices = typeof layer extends Layer.Layer<infer R> ? R : never;
  const _layerHasSpawner: AssertExtends<
    ChildProcessSpawner.ChildProcessSpawner,
    LayerServices
  > = true;

  const _serviceRefTag: AssertExtends<
    typeof jobs,
    Launcher.ServiceRef
  > = true;
  const _serviceRefString: AssertExtends<"wire/Key", Launcher.ServiceRef> =
    true;

  const spawned = spawn({
    node,
    process: command,
    ready: { services: [jobs, "wire/Key"], poll: "50 millis" },
  });
  type SpawnReq = ReqOf<typeof spawned>;
  type SpawnErr = ErrOf<typeof spawned>;
  const _spawnNeedsSpawner: AssertExtends<
    ChildProcessSpawner.ChildProcessSpawner,
    SpawnReq
  > = true;
  const _spawnNeedsScope: AssertExtends<Scope.Scope, SpawnReq> = true;
  const _spawnHasConfigError: AssertExtends<ConfigError, SpawnErr> = true;

  type AwaitReadyErr = ErrOf<ReturnType<typeof handle.awaitReady>>;
  const _awaitReadyNoConfig: AssertNotExtends<ConfigError, AwaitReadyErr> =
    true;
  const _awaitReadyHasTimedOut: AssertExtends<
    Launcher.ReadyTimedOut,
    AwaitReadyErr
  > = true;
  const _awaitReadyHasUnaddressed: AssertExtends<
    UnaddressedNode,
    AwaitReadyErr
  > = true;

  type KillErr = ErrOf<ReturnType<typeof handle.kill>>;
  const _killHasSpent: AssertExtends<Launcher.HandleSpent, KillErr> = true;

  type HandoffErr = ErrOf<ReturnType<typeof handle.handoff>>;
  const _handoffHasAssume: AssertExtends<AssumeTokenMismatch, HandoffErr> =
    true;
  const _handoffNoConfig: AssertNotExtends<ConfigError, HandoffErr> = true;

  const upped = up({ node, process: command }, { concurrency: "unbounded" });
  type UpErr = ErrOf<typeof upped>;
  const _upHasReadyTimedOut: AssertExtends<Launcher.ReadyTimedOut, UpErr> =
    true;
  const _upHasChildExited: AssertExtends<Launcher.ChildExited, UpErr> = true;
  const _upHasHandleNotReady: AssertExtends<Launcher.HandleNotReady, UpErr> =
    true;
  const _upHasHandleSpent: AssertExtends<Launcher.HandleSpent, UpErr> = true;
  const _upHasAssume: AssertExtends<AssumeTokenMismatch, UpErr> = true;
  const _upHasConfigError: AssertExtends<ConfigError, UpErr> = true;

  const assumed = assume(node, { token: "x" });
  type AssumeErr = ErrOf<typeof assumed>;
  const _assumeMismatch: AssertExtends<AssumeTokenMismatch, AssumeErr> = true;
  const _assumeReuse: AssertExtends<AssumeTokenReused, AssumeErr> = true;
  const _assumeNotReady: AssertExtends<AssumeNotReady, AssumeErr> = true;
  const _assumeUnreachable: AssertExtends<NodeUnreachable, AssumeErr> = true;
  const _assumeUnaddressed: AssertExtends<UnaddressedNode, AssumeErr> = true;

  void _mintIsRedactedToken;
  void _handleTokenBrand;
  void _readyTimeoutIsConfig;
  void _readyPollIsConfig;
  void _processIsFactory;
  void _entryIsFactory;
  void _layerHasSpawner;
  void _serviceRefTag;
  void _serviceRefString;
  void _spawnNeedsSpawner;
  void _spawnNeedsScope;
  void _spawnHasConfigError;
  void _awaitReadyNoConfig;
  void _awaitReadyHasTimedOut;
  void _awaitReadyHasUnaddressed;
  void _killHasSpent;
  void _handoffHasAssume;
  void _handoffNoConfig;
  void _upHasReadyTimedOut;
  void _upHasChildExited;
  void _upHasHandleNotReady;
  void _upHasHandleSpent;
  void _upHasAssume;
  void _upHasConfigError;
  void _assumeMismatch;
  void _assumeReuse;
  void _assumeNotReady;
  void _assumeUnreachable;
  void _assumeUnaddressed;
  void spawned;
  void upped;
  void assumed;
  void mintToken;
  void layer;
  void handle;
}
void typeLock;
