/**
 * **CLI** — HTTP client for the localhost {@link ControlService} control plane.
 *
 * @remarks
 * Talks to JSON endpoints exposed by {@link ControlService.make} (typically after
 * {@link ProcessGroup.serve}). Commands map to the contract-aligned REST routes.
 *
 * **Commands**
 *
 * | Subcommand | Purpose |
 * |------------|---------|
 * | `ls` | List processes and queues |
 * | `status [name]` | Detailed process or queue snapshot |
 * | `start <name>` | Start one process |
 * | `stop <name>` | Stop one process |
 * | `pause <name>` | Pause a queue |
 * | `resume <name>` | Resume a queue |
 * | `restart <name>` | Restart one process |
 * | `clear <name>` | Clear pending queue items |
 * | `now <name>` | Fire a process run immediately |
 * | `queues` | Queue listing only |
 *
 * @module Cli
 */

import { Console, Data, DateTime, Effect, Option } from "effect";
import { Argument, Command } from "effect/unstable/cli";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import Table from "cli-table3";
import prettyMs from "pretty-ms";
import type { ProcessGroupDetails, QueueDetails, ControlResponse } from "./index";

// ============================================================================
// Types
// ============================================================================

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isProcessGroupDetails = (value: unknown): value is ProcessGroupDetails =>
  isRecord(value)
  && typeof value["name"] === "string"
  && typeof value["type"] === "string"
  && typeof value["status"] === "string"
  && typeof value["uptime"] === "number";

const isQueueDetails = (value: unknown): value is QueueDetails =>
  isRecord(value)
  && typeof value["name"] === "string"
  && isRecord(value["size"])
  && typeof value["completed"] === "number";

const isControlResponse = (value: unknown): value is ControlResponse<unknown> =>
  isRecord(value) && typeof value["success"] === "boolean";

const decodeControlResponse = (value: unknown): ControlResponse<unknown> =>
  isControlResponse(value)
    ? value
    : { success: false, error: "Malformed control-service response" };

class CliRequestError extends Data.TaggedError("CliRequestError")<{
  readonly reason: string;
}> {}

const isCliRequestError = (error: unknown): error is CliRequestError => {
  if (typeof error !== "object" || error === null || !("_tag" in error) || !("reason" in error)) {
    return false;
  }
  return error._tag === "CliRequestError" && typeof error.reason === "string";
};

const toCliRequestError = (error: unknown): CliRequestError =>
  isCliRequestError(error)
    ? error
    : new CliRequestError({ reason: String(error) });

const decodeLsData = (
  value: unknown,
): { processes?: ProcessGroupDetails[]; queues?: QueueDetails[] } | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const processes = Array.isArray(value["processes"])
    ? value["processes"].filter(isProcessGroupDetails)
    : undefined;
  const queues = Array.isArray(value["queues"])
    ? value["queues"].filter(isQueueDetails)
    : undefined;
  return { processes, queues };
};

// ============================================================================
// HTTP Client
// ============================================================================

const requestControl = (
  baseUrl: string,
  method: "GET" | "POST",
  path: string,
): Effect.Effect<ControlResponse<unknown>, CliRequestError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const request = method === "POST"
      ? HttpClientRequest.post(`${baseUrl}${path}`)
      : HttpClientRequest.get(`${baseUrl}${path}`);
    const response = yield* HttpClient.execute(request);
    const json = yield* response.json;
    const decoded = decodeControlResponse(json);
    if (response.status >= 200 && response.status < 300 && decoded.success) {
      return decoded;
    }
    return yield* new CliRequestError({
      reason: decoded.error ?? `HTTP ${response.status}`,
    });
  }).pipe(Effect.mapError(toCliRequestError));

const getControl = (baseUrl: string, path: string) =>
  requestControl(baseUrl, "GET", path);

const postControl = (baseUrl: string, path: string) =>
  requestControl(baseUrl, "POST", path);

const statusByName = (
  baseUrl: string,
  name: string,
): Effect.Effect<ControlResponse<unknown>, CliRequestError, HttpClient.HttpClient> =>
  getControl(baseUrl, `/processes/${encodeURIComponent(name)}`).pipe(
    Effect.catch(() => getControl(baseUrl, `/queues/${encodeURIComponent(name)}`)),
  );

// ============================================================================
// Formatting Helpers
// ============================================================================

/**
 * Format last run timestamp
 * @internal
 */
const formatLastRun = (lastRun: Date | string | null | undefined): string => {
  if (lastRun === null || lastRun === undefined) return "-";
  const lastRunDate = typeof lastRun === "string"
    ? Option.match(DateTime.make(lastRun), {
      onNone: () => undefined,
      onSome: (dateTime) => DateTime.toDateUtc(dateTime),
    })
    : lastRun;
  if (lastRunDate === undefined) return "-";
  const now = DateTime.toEpochMillis(DateTime.nowUnsafe());
  const timeSince = now - lastRunDate.getTime();
  return prettyMs(timeSince, { compact: true }) + " ago";
};

/**
 * Format next run timestamp
 * @internal
 */
const formatNextRun = (nextRun: Date | string | null | undefined): string => {
  if (nextRun === null || nextRun === undefined) return "-";
  const nextRunDate = typeof nextRun === "string"
    ? Option.match(DateTime.make(nextRun), {
      onNone: () => undefined,
      onSome: (dateTime) => DateTime.toDateUtc(dateTime),
    })
    : nextRun;
  if (nextRunDate === undefined) return "-";
  const now = DateTime.toEpochMillis(DateTime.nowUnsafe());
  const timeUntil = nextRunDate.getTime() - now;
  
  // If more than 24 hours away, include the date
  if (timeUntil > 24 * 60 * 60 * 1000) {
    return nextRunDate.toLocaleDateString() + " " + nextRunDate.toLocaleTimeString();
  }
  
  return nextRunDate.toLocaleTimeString();
};

/**
 * Format processes table
 * @internal
 */
const formatProcesses = (processes: ProcessGroupDetails[]) => {
  if (processes.length === 0) return "No processes";
  
  const table = new Table({
    head: ["NAME", "TYPE", "STATUS", "UPTIME", "LAST RUN", "NEXT RUN", "EXECUTIONS"],
    style: { head: ["cyan"] }
  });
  
  processes.forEach(p => {
    table.push([
      p.name,
      p.type,
      p.status,
      p.uptime > 0 ? prettyMs(p.uptime, { compact: true }) : "-",
      formatLastRun(p.lastRun),
      formatNextRun(p.nextTriggerRun),
      p.executions !== undefined ? String(p.executions) : "-"
    ]);
  });
  
  return table.toString();
};

/**
 * Format queues table
 * @internal
 */
const formatQueues = (queues: QueueDetails[]) => {
  if (queues.length === 0) return "No queues";
  
  const table = new Table({
    head: ["NAME", "SIZE (H/N/L)", "TOTAL", "COMPLETED"],
    style: { head: ["cyan"] }
  });
  
  queues.forEach(p => {
    table.push([
      p.name,
      `${p.size.high}/${p.size.normal}/${p.size.low}`,
      String(p.size.total),
      String(p.completed)
    ]);
  });
  
  return table.toString();
};

/**
 * Format status details
 * @internal
 */
const formatStatus = (data: ControlResponse<unknown>) => {
  const table = new Table({
    style: { head: ["cyan"] }
  });
  
  if (data.type === "process") {
    if (!isProcessGroupDetails(data.data)) {
      return data.error ?? "Invalid process status payload";
    }
    const processData = data.data;
    table.push(
      ["Name", processData.name],
      ["Type", processData.type],
      ["Status", processData.status],
      ["Uptime", processData.uptime > 0 ? prettyMs(processData.uptime, { compact: true }) : "-"],
      ["Last Run", formatLastRun(processData.lastRun)],
      ["Next Run", formatNextRun(processData.nextTriggerRun)],
      ["Executions", processData.executions !== undefined ? String(processData.executions) : "-"]
    );
  } else if (data.type === "queue") {
    if (!isQueueDetails(data.data)) {
      return data.error ?? "Invalid queue status payload";
    }
    const queueData = data.data;
    table.push(
      ["Name", queueData.name],
      ["Size (Total)", String(queueData.size.total)],
      ["Size (High)", String(queueData.size.high)],
      ["Size (Normal)", String(queueData.size.normal)],
      ["Size (Low)", String(queueData.size.low)],
      ["Completed", String(queueData.completed)]
    );
  } else {
    return data.error ?? "Unsupported status response";
  }
  
  return table.toString();
};

// ============================================================================
// Command Definitions
// ============================================================================

/**
 * Create CLI commands
 * @internal
 */
const makeCommands = (controlUrl: string) => {
  const maybeName = Argument.string("name").pipe(Argument.optional);
  const requiredName = (
    name: Option.Option<string>,
    label: string,
    run: (name: string) => Effect.Effect<void, CliRequestError, HttpClient.HttpClient>,
  ) =>
    Option.match(name, {
      onNone: () => Console.error(`Missing ${label} name`),
      onSome: run,
    });

  // ls - List all processes and queues
  const ls = Command.make("ls", {}, () =>
    getControl(controlUrl, "/status").pipe(
      Effect.flatMap((body) => {
        const output: string[] = [];
        const data = decodeLsData(body.data);
        
        if (data?.processes !== undefined) {
          output.push("📋 PROCESSES");
          output.push(formatProcesses(data.processes));
        }
        
        if (data?.queues !== undefined) {
          if (output.length > 0) output.push("");
          output.push("🔄 QUEUES");
          output.push(formatQueues(data.queues));
        }
        
        return Console.log(output.join("\n"));
      })
    )
  );

  // status <name> - Get detailed status
  const status = Command.make("status", { name: maybeName }, ({ name }) =>
    Option.match(name, {
      onNone: () => Console.error("Missing process/queue name"),
      onSome: (n) =>
        statusByName(controlUrl, n).pipe(
          Effect.flatMap((body) => Console.log(formatStatus(body)))
        ),
    })
  );

  const processCommand = (
    command: "start" | "stop" | "restart" | "now",
    operation: "start" | "stop" | "restart" | "now",
  ) =>
    Command.make(command, { name: maybeName }, ({ name }) =>
      requiredName(name, "process", (processName) =>
        postControl(
          controlUrl,
          `/processes/${encodeURIComponent(processName)}/${operation}`,
        ).pipe(
          Effect.flatMap(() =>
            Console.log(`✅ Process '${processName}' ${command} completed successfully`)
          ),
        )
      )
    );

  const queueCommand = (
    command: "pause" | "resume" | "clear",
  ) =>
    Command.make(command, { name: maybeName }, ({ name }) =>
      requiredName(name, "queue", (queueName) =>
        postControl(
          controlUrl,
          `/queues/${encodeURIComponent(queueName)}/${command}`,
        ).pipe(
          Effect.flatMap((body) => {
            const suffix = command === "clear" && isRecord(body.data) && typeof body.data["cleared"] === "number"
              ? ` (${String(body.data["cleared"])} cleared)`
              : "";
            return Console.log(`✅ Queue '${queueName}' ${command} completed successfully${suffix}`);
          }),
        )
      )
    );

  const start = processCommand("start", "start");
  const stop = processCommand("stop", "stop");
  const restart = processCommand("restart", "restart");
  const now = processCommand("now", "now");
  const pause = queueCommand("pause");
  const resume = queueCommand("resume");
  const clear = queueCommand("clear");

  // queues - List all queues
  const queues = Command.make("queues", {}, () =>
    getControl(controlUrl, "/queues").pipe(
      Effect.flatMap((body) => {
        const queuesData = Array.isArray(body.data)
          ? body.data.filter(isQueueDetails)
          : undefined;
        if (queuesData !== undefined && queuesData.length > 0) {
          return Console.log("🔄 QUEUES\n" + formatQueues(queuesData));
        }
        return Console.log("No queues");
      })
    )
  );

  return { ls, status, start, stop, pause, resume, restart, now, clear, queues };
};

// ============================================================================
// Public API
// ============================================================================

/**
 * Create a CLI for controlling a {@link ProcessGroup}.
 *
 * @remarks
 * Creates a command-line interface that communicates with the HTTP control service.
 * The CLI must be run while the {@link ProcessGroup} is running with {@link ProcessGroup.serve} (HTTP control API).
 * 
 * @param config - Configuration object
 * @param config.name - CLI name (shown in help text)
 * @param config.version - CLI version (shown in help text)
 * @param config.port - Port where control service is listening
 * 
 * @returns Effect CLI application ready to run
 * 
 * @example
 * ```typescript
 * import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
 * import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
 * import * as NodeServices from "@effect/platform-node/NodeServices";
 * import { Effect, Layer } from "effect";
 * import { createCli } from "@nikscripts/effect-pm";
 *
 * const cli = createCli({ name: "My App CLI", version: "1.0.0", port: 3001 });
 * const platform = Layer.mergeAll(NodeServices.layer, NodeHttpClient.layerNodeHttp);
 *
 * Effect.suspend(() => cli(process.argv)).pipe(
 *   Effect.provide(platform),
 *   NodeRuntime.runMain
 * );
 * ```
 * 
 * @public
 */
export const createCli = (config: {
  name: string;
  version: string;
  port?: number;
}) => {
  const port = config.port ?? 3001;
  const controlUrl = `http://127.0.0.1:${port}`;
  
  const commands = makeCommands(controlUrl);
  
  const root = Command.make(
    "pm", 
    {}, 
    () => Effect.logInfo(`${config.name}. Use --help for commands.`)
  ).pipe(
    Command.withSubcommands([
      commands.ls,
      commands.status,
      commands.start,
      commands.stop,
      commands.pause,
      commands.resume,
      commands.restart,
      commands.now,
      commands.clear,
      commands.queues,
    ])
  );

  return Command.runWith(root, {
    version: config.version,
  });
};

/**
 * Run the CLI
 * 
 * @remarks
 * Convenience function that creates and runs a CLI with default configuration.
 * For more control, use {@link createCli} directly.
 * 
 * @param config - Configuration object
 * @param config.name - CLI name
 * @param config.version - CLI version
 * @param config.port - Control service port
 * @param argv - Process arguments (defaults to process.argv)
 * 
 * @example
 * ```typescript
 * import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
 * import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
 * import * as NodeServices from "@effect/platform-node/NodeServices";
 * import { Effect, Layer } from "effect";
 * import { runCli } from "@nikscripts/effect-pm";
 *
 * const platform = Layer.mergeAll(NodeServices.layer, NodeHttpClient.layerNodeHttp);
 *
 * runCli({ name: "My App", version: "1.0.0", port: 3001 }).pipe(
 *   Effect.provide(platform),
 *   NodeRuntime.runMain
 * );
 * ```
 * 
 * @public
 */
export const runCli = (
  config: {
    name: string;
    version: string;
    port?: number;
  },
  argv: string[] = process.argv
) => {
  const cli = createCli(config);
  return Effect.suspend(() => cli(argv));
};

/**
 * Control-plane HTTP CLI factory helpers.
 *
 * @remarks
 * {@link createCli} and {@link runCli} are the same bindings as
 * {@link Cli.create} and {@link Cli.run}.
 *
 * @public
 */
export const Cli = {
  create: createCli,
  run: runCli,
} as const;

