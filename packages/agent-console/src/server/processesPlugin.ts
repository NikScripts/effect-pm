/**
 * Long-running processes, streamed.
 *
 * Builds are the motivating case: EAS has no streaming API at all — its
 * GraphQL schema exposes no subscription root, `Build.logFileUrls` are
 * finalized files rather than a live feed, and webhooks fire only on
 * completion. `eas-cli` synthesizes progress by polling. Rather than have the
 * phone poll a cloud API over a flaky link, the Mac runs the process once and
 * this streams its output to everyone watching.
 *
 * Nothing here is build-specific — a test run, an install, a git operation all
 * want the same shape.
 *
 * Safety, given this is reachable from the network:
 *
 * - Commands are spawned as argv arrays with no shell, so there is no quoting
 *   or metacharacter surface to get wrong.
 * - Only binaries in ALLOWED_COMMANDS may start. An allowlist, not a denylist:
 *   a denylist here would be a remote shell with extra steps.
 * - `cwd` must resolve inside the files root, checked with realpath so a
 *   symlink cannot step outside it.
 *
 * @internal
 */
import { spawn, type ChildProcess } from "node:child_process";
import { appendFile, mkdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { Connect, Plugin } from "vite";

/** Argv[0] values that may be spawned. Anything else is refused. */
const ALLOWED_COMMANDS = new Set(["eas", "npx", "pnpm", "git", "node"]);

/** Lines retained per process, so a client that connects late still sees what
 * it missed rather than joining a silent stream mid-build. */
const BACKLOG_LINES = 2000;

/** Where full transcripts land. The in-memory backlog is capped, but a build
 * that failed an hour ago is exactly the one worth reading, so every line is
 * also appended to a file that outlives the process and the server. */
const LOG_DIR = ".agent-console/logs";

type Line = { readonly stream: "stdout" | "stderr"; readonly text: string };
type Event = { readonly kind: "line"; readonly line: Line } | { readonly kind: "exit"; readonly exitCode: number | undefined };

type Managed = {
  readonly id: string;
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly logPath: string;
  readonly startedAt: number;
  readonly child: ChildProcess;
  readonly backlog: Line[];
  readonly listeners: Set<(event: Event) => void>;
  exitCode: number | undefined;
  exitedAt: number | undefined;
};

const processes = new Map<string, Managed>();

const readJson = async (req: Connect.IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const emit = (managed: Managed, event: Event): void => {
  for (const listener of managed.listeners) listener(event);
};

const push = (managed: Managed, stream: "stdout" | "stderr", chunk: Buffer): void => {
  const text = chunk.toString("utf8");
  void appendFile(managed.logPath, text).catch(() => {
    // A failed log write must never take down the process being watched.
  });
  for (const value of text.split(/\r?\n/)) {
    if (value === "") continue;
    const line: Line = { stream, text: value };
    managed.backlog.push(line);
    if (managed.backlog.length > BACKLOG_LINES) managed.backlog.shift();
    emit(managed, { kind: "line", line });
  }
};

const summarize = (managed: Managed) => ({
  id: managed.id,
  command: managed.command,
  args: managed.args,
  cwd: managed.cwd,
  logPath: managed.logPath,
  startedAt: managed.startedAt,
  exitCode: managed.exitCode,
  exitedAt: managed.exitedAt,
  running: managed.exitedAt === undefined,
});

export const processesPlugin = (): Plugin => {
  const root = resolve(process.env.AGENT_CONSOLE_FILES_ROOT ?? process.cwd());
  const logDir = resolve(root, LOG_DIR);

  const resolveCwd = async (requested: unknown): Promise<string | undefined> => {
    if (requested === undefined) return root;
    if (typeof requested !== "string") return undefined;
    const candidate = resolve(root, requested);
    const real = await realpath(candidate).catch(() => undefined);
    if (real === undefined) return undefined;
    const realRoot = await realpath(root).catch(() => root);
    const within = relative(realRoot, real);
    return within.startsWith("..") || isAbsolute(within) ? undefined : real;
  };

  const handler: Connect.NextHandleFunction = (req, res, next) => {
    const url = req.url ?? "";
    if (!url.startsWith("/processes")) {
      next();
      return;
    }

    const json = (status: number, body: unknown): void => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(body));
    };

    void (async () => {
      const path = url.split("?")[0];

      if (path === "/processes" && req.method === "GET") {
        json(200, { data: [...processes.values()].map(summarize) });
        return;
      }

      if (path === "/processes" && req.method === "POST") {
        const body = await readJson(req);
        if (!isRecord(body) || typeof body.command !== "string" || !Array.isArray(body.args)) {
          json(400, { error: "Expected { command: string, args: string[], cwd?: string }" });
          return;
        }
        if (!ALLOWED_COMMANDS.has(body.command)) {
          json(403, { error: `Command not allowed: ${body.command}`, allowed: [...ALLOWED_COMMANDS] });
          return;
        }
        const args = body.args.filter((a): a is string => typeof a === "string");
        const cwd = await resolveCwd(body.cwd);
        if (cwd === undefined) {
          json(400, { error: "cwd must resolve inside the files root" });
          return;
        }

        await mkdir(logDir, { recursive: true }).catch(() => undefined);
        const id = `proc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        const logPath = join(logDir, `${id}.log`);

        // No shell: argv goes straight to execve, so nothing in `args` can be
        // interpreted as a redirect, a pipe, or a command separator.
        const child = spawn(body.command, args, { cwd, shell: false, env: process.env });
        const managed: Managed = {
          id,
          command: body.command,
          args,
          cwd,
          logPath,
          startedAt: Date.now(),
          child,
          backlog: [],
          listeners: new Set(),
          exitCode: undefined,
          exitedAt: undefined,
        };
        processes.set(id, managed);

        void appendFile(logPath, `$ ${body.command} ${args.join(" ")}\n(cwd ${cwd})\n\n`).catch(() => undefined);

        child.stdout?.on("data", (chunk: Buffer) => push(managed, "stdout", chunk));
        child.stderr?.on("data", (chunk: Buffer) => push(managed, "stderr", chunk));
        child.on("error", (error) => push(managed, "stderr", Buffer.from(String(error))));
        child.on("close", (code) => {
          managed.exitCode = code ?? undefined;
          managed.exitedAt = Date.now();
          void appendFile(logPath, `\n(exit ${code ?? "unknown"})\n`).catch(() => undefined);
          emit(managed, { kind: "exit", exitCode: managed.exitCode });
        });

        json(201, summarize(managed));
        return;
      }

      const streamMatch = /^\/processes\/([^/]+)\/stream$/.exec(path);
      if (streamMatch !== null && req.method === "GET") {
        const managed = processes.get(streamMatch[1]);
        if (managed === undefined) {
          json(404, { error: "No such process" });
          return;
        }
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        // No proxy sits in front of vite here, but a client may add one; this
        // is the header that stops an intermediary buffering an event stream
        // into silence.
        res.setHeader("X-Accel-Buffering", "no");

        const send = (event: string, data: unknown): void => {
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };

        // Backlog first, so a late subscriber sees the whole run.
        for (const line of managed.backlog) send("line", line);
        if (managed.exitedAt !== undefined) {
          send("exit", { exitCode: managed.exitCode });
          res.end();
          return;
        }

        const listener = (event: Event): void => {
          if (event.kind === "exit") {
            send("exit", { exitCode: event.exitCode });
            res.end();
            return;
          }
          send("line", event.line);
        };
        managed.listeners.add(listener);

        const keepAlive = setInterval(() => res.write(": ping\n\n"), 15_000);
        req.on("close", () => {
          clearInterval(keepAlive);
          managed.listeners.delete(listener);
        });
        return;
      }

      const stopMatch = /^\/processes\/([^/]+)\/stop$/.exec(path);
      if (stopMatch !== null && req.method === "POST") {
        const managed = processes.get(stopMatch[1]);
        if (managed === undefined) {
          json(404, { error: "No such process" });
          return;
        }
        managed.child.kill("SIGTERM");
        json(200, summarize(managed));
        return;
      }

      json(404, { error: "Not found" });
    })();
  };

  return {
    name: "agent-console-processes",
    configureServer(server) {
      server.middlewares.use(handler);
      server.config.logger.info(`  ->  procs:   /processes  (${[...ALLOWED_COMMANDS].join(", ")}), logs in ${logDir}`);
    },
  };
};
