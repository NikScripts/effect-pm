/**
 * CLI for ProcessGroup Control
 *
 * Provides command-line interface for controlling and monitoring a
 * {@link ProcessGroup} via the HTTP control service.
 * 
 * @remarks
 * This CLI communicates with the HTTP control service started by
 * {@link ProcessGroup.serve} / {@link ControlService.make}. Provides commands for listing, starting,
 * stopping, and monitoring processes and queues.
 * 
 * **Available Commands:**
 * - `ls` - List all processes and queues
 * - `status <name>` - Get detailed status
 * - `start [name]` - Start process(es)
 * - `stop [name]` - Stop process(es)
 * - `pause <name>` - Pause a queue
 * - `resume <name>` - Resume a queue
 * - `restart [name]` - Restart process/queue
 * - `shutdown <name>` - Shutdown a queue
 * - `now <name>` - Run process immediately
 * - `queues` - List all queues
 * 
 * @module cli
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

type ControlCommand =
  | "ls"
  | "status"
  | "start"
  | "stop"
  | "pause"
  | "resume"
  | "restart"
  | "shutdown"
  | "now"
  | "queues";

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

/**
 * Send command to control service
 * @internal
 */
const postCommand = (controlUrl: string) => (command: ControlCommand, name?: string) =>
  Effect.gen(function* () {
    const request = yield* HttpClientRequest.bodyJson(
      HttpClientRequest.post(controlUrl),
      { command, name },
    );
    const response = yield* HttpClient.execute(request);
    const json = yield* response.json;
    const decoded = decodeControlResponse(json);
    if (response.status >= 200 && response.status < 300) {
      return decoded;
    }
    return yield* new CliRequestError({
      reason: decoded.error ?? `HTTP ${response.status}`,
    });
  });

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
      formatNextRun(p.nextRun),
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
      ["Next Run", formatNextRun(processData.nextRun)],
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
  const post = postCommand(controlUrl);
  const maybeName = Argument.string("name").pipe(Argument.optional);

  // ls - List all processes and queues
  const ls = Command.make("ls", {}, () =>
    post("ls").pipe(
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
        post("status", n).pipe(
          Effect.flatMap((body) => Console.log(formatStatus(body)))
        ),
    })
  );

  // Factory for commands with optional name
  const makeGlobalOrNamed = (cmd: ControlCommand) =>
    Command.make(cmd, { name: maybeName }, ({ name }) =>
      post(cmd, Option.getOrUndefined(name)).pipe(
        Effect.flatMap((body) => 
          body.success 
            ? Console.log(`✅ ${cmd} completed successfully`)
            : Console.error(`❌ ${body.error ?? "Command failed"}`)
        )
      )
    );

  const start = makeGlobalOrNamed("start");
  const stop = makeGlobalOrNamed("stop");
  const pause = makeGlobalOrNamed("pause");
  const resume = makeGlobalOrNamed("resume");
  const restart = makeGlobalOrNamed("restart");

  // shutdown <name> - Shutdown a queue
  const shutdown = Command.make("shutdown", { name: maybeName }, ({ name }) =>
    Option.match(name, {
      onNone: () => Console.error("Missing queue name"),
      onSome: (n) =>
        post("shutdown", n).pipe(
          Effect.flatMap((body) => 
            body.success 
              ? Console.log(`✅ Queue '${n}' shutdown successfully`)
              : Console.error(`❌ ${body.error ?? "Shutdown failed"}`)
          )
        ),
    })
  );

  // now <name> - Run process immediately
  const now = Command.make("now", { name: maybeName }, ({ name }) =>
    Option.match(name, {
      onNone: () => Console.error("Missing process name"),
      onSome: (n) =>
        post("now", n).pipe(
          Effect.flatMap((body) => 
            body.success 
              ? Console.log(`✅ Process '${n}' executed immediately`)
              : Console.error(`❌ ${body.error ?? "Execution failed"}`)
          )
        ),
    })
  );

  // queues - List all queues
  const queues = Command.make("queues", {}, () =>
    post("queues").pipe(
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

  return { ls, status, start, stop, pause, resume, restart, shutdown, now, queues };
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
 * // Create CLI
 * const cli = createCli({
 *   name: "My App CLI",
 *   version: "1.0.0",
 *   port: 3001
 * });
 * 
 * // Run CLI (typically in a separate script)
 * Effect.suspend(() => cli(process.argv)).pipe(
 *   Effect.provide(NodeServices.layer),
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
  const controlUrl = `http://127.0.0.1:${port}/control`;
  
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
      commands.shutdown,
      commands.now,
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
 * // In your CLI script (e.g., bin/pm-cli.ts)
 * import { runCli } from "@nikscripts/effect-pm/cli";
 * 
 * runCli({
 *   name: "My App Process Group",
 *   version: "1.0.0",
 *   port: 3001
 * });
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

