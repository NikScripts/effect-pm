#!/usr/bin/env tsx

/**
 * CLI Script for Effect Process Manager
 * 
 * This script provides a command-line interface to control and monitor
 * the ProcessManager example running in example.ts
 * 
 * **Prerequisites:**
 * - The example.ts must be running (it starts the control service)
 * - Control service runs on port 3001 by default
 * 
 * **Usage:**
 * ```bash
 * # Make sure example.ts is running in another terminal:
 * npm run example
 * 
 * # Then use the CLI:
 * npm run cli ls                    # List all processes and pools
 * npm run cli status queue-adder    # Get status of a process
 * npm run cli pools                 # List all pools
 * npm run cli start queue-adder     # Start a process
 * npm run cli stop queue-adder      # Stop a process
 * npm run cli now queue-adder       # Run process immediately
 * ```
 * 
 * **Available Commands:**
 * - `ls` - List all processes and pools
 * - `status <name>` - Get detailed status for a process
 * - `start [name]` - Start process(es) (all if no name)
 * - `stop [name]` - Stop process(es) (all if no name)
 * - `pause <name>` - Pause a pool
 * - `resume <name>` - Resume a pool
 * - `restart [name]` - Restart process/pool (all if no name)
 * - `shutdown <name>` - Shutdown a pool permanently
 * - `now <name>` - Run a cron process immediately
 * - `pools` - List all pools with details
 */

import { runCli } from "../src/cli";

// Get port from environment or use default
const CONTROL_PORT = Number(process.env.HOME_SERVER_PORT) || 3001;

runCli({
  name: "Effect-PM Demo CLI",
  version: "0.1.0",
  port: CONTROL_PORT,
});

