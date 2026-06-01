/**
 * **ControlService** — localhost JSON control plane for a {@link ProcessGroup}.
 *
 * @remarks
 * - **Binding** — `127.0.0.1` only (not exposed on LAN interfaces).
 * - **Transport** — Contract-aligned REST routes; responses use
 *   {@link ControlResponse}. `GET /health` for probes.
 * - **Payloads** — Request bodies are validated with **Effect Schema**; responses are
 *   JSON-encoded safely from plain objects.
 * - **Contract** — `GET /contract` is always available because the service is
 *   built from a typed {@link ProcessGroup}.
 *
 * The namespace also re-exports {@link createCli} and {@link runCli} so operators can
 * depend on a single import when wiring tooling.
 *
 * @module ControlService
 */

// @effect-diagnostics strictEffectProvide:off — control transport entry wiring provides router layers per serve/group.

import { Effect, Layer, Scope } from "effect";
import type {
  ProcessGroupEntry,
  ProcessGroupEntryRequirements,
  ProcessGroupServiceDefinition,
  TypedProcessGroup,
} from "./ProcessGroup";
import type { CommandAuthVerifierService } from "./CommandAuth";
import type { ProcessManagerGroupConfigItem } from "./ProcessManager";
import type { ProcessStorage } from "./ProcessStorage";
import {
  ControlRouter,
  ControlTransportError,
  ControlTransportServer,
} from "./ControlProtocol";
export type { ControlResponse } from "./ControlProtocol";
import { ControlTransportHttp } from "./ControlTransportHttp";
import { createCli, runCli } from "./cli";

type TypedControlServiceOptions<
  Id extends string,
  Entries extends readonly ProcessGroupEntry[],
  Error = unknown,
> = {
  readonly port?: number;
  readonly auth?: CommandAuthVerifierService;
  readonly group: TypedProcessGroup<Id, Entries, Error>;
};

const serveWithTransport: Effect.Effect<
  void,
  ControlTransportError,
  Scope.Scope | ControlTransportServer | ControlRouter
> =
  Effect.gen(function* () {
    const transport = yield* ControlTransportServer;
    yield* transport.serve;
  });

const scopedDiscard = <E, R>(
  effect: Effect.Effect<void, E, Scope.Scope | R>,
): Layer.Layer<never, E, R> =>
  Layer.effectDiscard(effect);

/**
 * Start the HTTP control service
 * 
 * @remarks
 * Starts a localhost-only HTTP server for controlling and monitoring a typed
 * {@link ProcessGroup}. The server provides contract-aligned JSON routes for CLI
 * tools and remote {@link ProcessManager} clients.
 * 
 * **Security:**
 * - Listens on 127.0.0.1 (localhost) only
 * - Not accessible from external networks
 * - No authentication (relies on localhost security)
 * 
 * **Lifecycle:**
 * - Automatically starts HTTP server
 * - Keeps running until scope is closed
 * - Gracefully shuts down on scope closure
 * - Destroys active connections on shutdown
 * 
 * **API Endpoints:**
 * - `GET /contract` - Schema-backed typed group contract when available
 * - `GET /status` - Combined process/queue status
 * - `GET /processes` / `GET /processes/:id` - Process listings and status
 * - `POST /processes/:id/start|stop|restart|now` - Process controls
 * - `GET /queues` / `GET /queues/:id` - Queue listings and status
 * - `POST /queues/:id/start|pause|resume|clear` - Queue controls
 * - `GET /health` - Health check
 * 
 * @typeParam R - ProcessGroup requirements type
 * 
 * @param options - Configuration object
 * @param options.port - HTTP port to listen on (default: 3001)
 * @param options.group - ProcessGroup instance to control
 * 
 * @returns Scoped effect that runs the control service
 * 
 * @example
 * ```typescript
 * const program = Effect.gen(function* () {
 *   const group = yield* ProcessGroup.make("@app/Group", [EmailQueue, EmailProcess] as const);
 *   
 *   // Start control service on port 3001
 *   yield* ControlService.make({
 *     port: 3001,
 *     group
 *   });
 *   
 *   // Service runs until program ends
 *   yield* Effect.never;
 * }).pipe(Effect.scoped);
 * 
 * // Provide dependencies and run
 * program.pipe(
 *   Effect.provide(EmailQueue.layer),
 *   Effect.runPromise
 * );
 * ```
 * 
 * @example
 * ```typescript
 * // With custom port
 * yield* ControlService.make({
 *   port: 8080,
 *   group
 * });
 * 
 * // Now accessible at http://localhost:8080/status
 * ```
 * 
 * @public
 */
function startControlService<
  const Id extends string,
  const Entries extends readonly ProcessGroupEntry[],
  Error,
>(
  options: TypedControlServiceOptions<Id, Entries, Error>,
): Effect.Effect<
  void,
  ControlTransportError,
  Scope.Scope | ProcessGroupEntryRequirements<Entries> | ProcessStorage.Services
>;
function startControlService(
  options: TypedControlServiceOptions<string, readonly ProcessGroupEntry[], unknown>,
): Effect.Effect<void, ControlTransportError, Scope.Scope | unknown | ProcessStorage.Services> {
  return ControlTransportHttp.server({
    port: options.port,
    auth: options.auth,
  }).serve.pipe(
    Effect.provide(ControlRouter.layer(options.group)),
  );
}

const controlServiceLayerFromValue = <
  const Id extends string,
  const Entries extends readonly ProcessGroupEntry[],
  Error,
>(
  group: TypedProcessGroup<Id, Entries, Error>,
): Layer.Layer<
  never,
  ControlTransportError,
  ControlTransportServer | ProcessGroupEntryRequirements<Entries> | ProcessStorage.Services
> =>
  scopedDiscard(
    serveWithTransport.pipe(Effect.provide(ControlRouter.layer(group))),
  );

const controlServiceLayerFromGroup = <
  Self,
  const Id extends string,
  const Entries extends readonly ProcessGroupEntry[],
  const ConfigItems extends readonly ProcessManagerGroupConfigItem[] = readonly [],
>(
  group: ProcessGroupServiceDefinition<Self, Id, Entries, ConfigItems>,
): Layer.Layer<
  never,
  ControlTransportError,
  ControlTransportServer | Self | ProcessGroupEntryRequirements<Entries> | ProcessStorage.Services
> =>
  scopedDiscard(
    serveWithTransport.pipe(Effect.provide(ControlRouter.layerFromGroup(group))),
  );

const controlServiceHttpLayer = <
  Self,
  const Id extends string,
  const Entries extends readonly ProcessGroupEntry[],
  const ConfigItems extends readonly ProcessManagerGroupConfigItem[] = readonly [],
>(
  group: ProcessGroupServiceDefinition<Self, Id, Entries, ConfigItems>,
  options: {
    readonly port?: number;
    readonly auth?: CommandAuthVerifierService;
  } = {},
): Layer.Layer<
  never,
  ControlTransportError,
  Self | ProcessGroupEntryRequirements<Entries> | ProcessStorage.Services
> =>
  controlServiceLayerFromGroup(group).pipe(
    Layer.provide(ControlTransportHttp.serverLayer(options)),
  );

const isProcessGroupServiceDefinition = (
  group: unknown,
): group is ProcessGroupServiceDefinition<
  unknown,
  string,
  readonly ProcessGroupEntry[]
> =>
  typeof group === "function" &&
  "make" in group &&
  "layer" in group &&
  "contract" in group;

function controlServiceLayer<
  const Id extends string,
  const Entries extends readonly ProcessGroupEntry[],
  Error,
>(
  group: TypedProcessGroup<Id, Entries, Error>,
): Layer.Layer<
  never,
  ControlTransportError,
  ControlTransportServer | ProcessGroupEntryRequirements<Entries> | ProcessStorage.Services
>;
function controlServiceLayer<
  Self,
  const Id extends string,
  const Entries extends readonly ProcessGroupEntry[],
>(
  group: ProcessGroupServiceDefinition<Self, Id, Entries>,
): Layer.Layer<
  never,
  ControlTransportError,
  ControlTransportServer | Self | ProcessGroupEntryRequirements<Entries> | ProcessStorage.Services
>;
function controlServiceLayer(
  group:
    | TypedProcessGroup<string, readonly ProcessGroupEntry[], unknown>
    | ProcessGroupServiceDefinition<unknown, string, readonly ProcessGroupEntry[]>,
): Layer.Layer<
  never,
  ControlTransportError,
  ControlTransportServer | unknown | ProcessStorage.Services
> {
  return isProcessGroupServiceDefinition(group)
    ? controlServiceLayerFromGroup(group)
    : controlServiceLayerFromValue(group);
}

interface ControlServiceApi {
  readonly make: typeof startControlService;
  readonly layer: typeof controlServiceLayer;
  readonly layerHttp: typeof controlServiceHttpLayer;
  readonly createCli: typeof createCli;
  readonly runCli: typeof runCli;
}

/**
 * Control plane entrypoints.
 *
 * @public
 */
export const ControlService: ControlServiceApi = {
  /**
   * Acquire a localhost HTTP listener for contract-aligned REST routes until the scope ends.
   */
  make: startControlService,
  /** Build a control service from an externally provided server transport. */
  layer: controlServiceLayer,
  /** Build the default localhost HTTP control service layer. */
  layerHttp: controlServiceHttpLayer,
  /** Build an `@effect/cli` application targeting this service’s port. */
  createCli,
  /** `Effect` that runs {@link createCli} against `process.argv` (or a passed argv). */
  runCli,
} as const;