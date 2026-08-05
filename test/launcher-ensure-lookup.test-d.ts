/**
 * Type-level lock: Launcher.ensureLookup / UpOptions.lookup channels.
 */
import type { Effect, Scope } from "effect";
import type { ChildProcessSpawner } from "effect/unstable/process";
import type * as Launcher from "../src/Launcher";

type ErrOf<T> = T extends Effect.Effect<infer _A, infer E, infer _R> ? E : never;
type CtxOf<T> = T extends Effect.Effect<infer _A, infer _E, infer R> ? R : never;
type AssertExtends<A, B> = [A] extends [B] ? true : false;

function typeLock(
  ensureLookup: typeof Launcher.ensureLookup,
  up: typeof Launcher.up,
  result: Launcher.EnsureLookupResult,
  opts: Launcher.EnsureLookupOptions,
): void {
  type EnsureErrors = ErrOf<ReturnType<typeof ensureLookup>>;
  type UpErrors = ErrOf<ReturnType<typeof up>>;
  type EnsureCtx = CtxOf<ReturnType<typeof ensureLookup>>;

  const _ensureHasNotRunning: AssertExtends<
    Launcher.LookupNotRunning,
    EnsureErrors
  > = true;
  const _ensureHasAddressRequired: AssertExtends<
    Launcher.LookupAddressRequired,
    EnsureErrors
  > = true;
  const _ensureHasAlreadyUp: AssertExtends<
    Launcher.NodeAlreadyUp,
    EnsureErrors
  > = true;
  const _upHasNotRunning: AssertExtends<Launcher.LookupNotRunning, UpErrors> =
    true;
  const _ensureNeedsSpawner: AssertExtends<
    ChildProcessSpawner.ChildProcessSpawner | Scope.Scope,
    EnsureCtx
  > = true;

  const _spawned: boolean = result.spawned;
  const _path: string = result.path;
  const _nodePath: string = result.node.path;
  const _optsPath: string | undefined = opts.path;

  void _ensureHasNotRunning;
  void _ensureHasAddressRequired;
  void _ensureHasAlreadyUp;
  void _upHasNotRunning;
  void _ensureNeedsSpawner;
  void _spawned;
  void _path;
  void _nodePath;
  void _optsPath;
}

void typeLock;
