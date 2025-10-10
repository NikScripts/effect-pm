/**
 * CLI for Process Manager Control
 * 
 * Provides command-line interface for controlling and monitoring ProcessManager
 * via the HTTP control service.
 * 
 * @remarks
 * This CLI communicates with the HTTP control service started by
 * {@link startControlService}. Provides commands for listing, starting,
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

import { Args, Command } from "@effect/cli";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { Console, Effect, Option } from "effect";
import Table from "cli-table3";
import prettyMs from "pretty-ms";

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

// ============================================================================
// HTTP Client
// ============================================================================

/**
 * Send command to control service
 * @internal
 */
const postCommand = (controlUrl: string) => (command: ControlCommand, name?: string) =>
  Effect.tryPromise({
    try: async () => {
      const res = await fetch(controlUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command, name }),
      });
      const json = await res.json();
      return { status: res.status, json } as { status: number; json: any };
    },
    catch: (e) => new Error(e instanceof Error ? e.message : String(e)),
  }).pipe(
    Effect.flatMap(({ status, json }) =>
      status >= 200 && status < 300
        ? Effect.succeed(json)
        : Effect.fail(new Error(json?.error ?? `HTTP ${status}`))
    )
  );

// ============================================================================
// Formatting Helpers
// ============================================================================

/**
 * Format last run timestamp
 * @internal
 */
const formatLastRun = (lastRun: string | null | undefined): string => {
  if (!lastRun) return "-";
  const lastRunDate = new Date(lastRun);
  const now = Date.now();
  const timeSince = now - lastRunDate.getTime();
  return prettyMs(timeSince, { compact: true }) + " ago";
};

/**
 * Format next run timestamp
 * @internal
 */
const formatNextRun = (nextRun: string | null | undefined): string => {
  if (!nextRun) return "-";
  const nextRunDate = new Date(nextRun);
  const now = Date.now();
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
const formatProcesses = (processes: any[]) => {
  if (!processes || processes.length === 0) return "No processes";
  
  const table = new Table({
    head: ["NAME", "TYPE", "STATUS", "UPTIME", "LAST RUN", "NEXT RUN", "RUN COUNT"],
    style: { head: ["cyan"] }
  });
  
  processes.forEach(p => {
    table.push([
      p.name,
      p.type,
      p.status,
      p.uptime ? prettyMs(p.uptime, { compact: true }) : "-",
      formatLastRun(p.lastRun),
      formatNextRun(p.nextRun),
      p.runCount !== undefined ? String(p.runCount) : "-"
    ]);
  });
  
  return table.toString();
};

/**
 * Format queues table
 * @internal
 */
const formatQueues = (queues: any[]) => {
  if (!queues || queues.length === 0) return "No queues";
  
  const table = new Table({
    head: ["NAME", "SIZE", "PROCESSED"],
    style: { head: ["cyan"] }
  });
  
  queues.forEach(q => {
    table.push([
      q.name,
      String(q.queueSize),
      String(q.processedCount)
    ]);
  });
  
  return table.toString();
};

/**
 * Format status details
 * @internal
 */
const formatStatus = (data: any) => {
  const table = new Table({
    style: { head: ["cyan"] }
  });
  
  if (data.type === "process") {
    table.push(
      ["Name", data.data.name],
      ["Type", data.data.type],
      ["Status", data.data.status],
      ["Uptime", data.data.uptime ? prettyMs(data.data.uptime, { compact: true }) : "-"],
      ["Last Run", formatLastRun(data.data.lastRun)],
      ["Next Run", formatNextRun(data.data.nextRun)],
      ["Run Count", data.data.runCount !== undefined ? String(data.data.runCount) : "-"]
    );
  } else if (data.type === "queue") {
    table.push(
      ["Name", data.data.name],
      ["Size", String(data.data.queueSize)],
      ["Processed", String(data.data.processedCount)]
    );
  } else {
    return JSON.stringify(data, null, 2);
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
  const maybeName = Args.text({ name: "name" }).pipe(Args.optional);

  // ls - List all processes and queues
  const ls = Command.make("ls", {}, () =>
    post("ls").pipe(
      Effect.flatMap((body) => {
        const output: string[] = [];
        
        if (body.data?.processes) {
          output.push("📋 PROCESSES");
          output.push(formatProcesses(body.data.processes));
        }
        
        if (body.data?.queues) {
          if (output.length > 0) output.push("");
          output.push("🔄 QUEUES");
          output.push(formatQueues(body.data.queues));
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
            : Console.error(`❌ ${body.error || "Command failed"}`)
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
              : Console.error(`❌ ${body.error || "Shutdown failed"}`)
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
              : Console.error(`❌ ${body.error || "Execution failed"}`)
          )
        ),
    })
  );

  // queues - List all queues
  const queues = Command.make("queues", {}, () =>
    post("queues").pipe(
      Effect.flatMap((body) => {
        if (body.data) {
          return Console.log("🔄 QUEUES\n" + formatQueues(body.data));
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
 * Create a CLI for controlling ProcessManager
 * 
 * @remarks
 * Creates a command-line interface that communicates with the HTTP control service.
 * The CLI must be run while the ProcessManager is running with {@link startControlService}.
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
 *   Effect.provide(NodeContext.layer),
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

  return Command.run(root, {
    name: config.name,
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
 *   name: "My App Process Manager",
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
  
  Effect.suspend(() => cli(argv)).pipe(
    Effect.provide(NodeContext.layer),
    NodeRuntime.runMain
  );
};

