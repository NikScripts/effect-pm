#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off — bin entry owns Node CLI filesystem and prompt bindings.
/**
 * Admin CLI for `effect-pm`.
 *
 * @remarks
 * Currently exposes:
 *
 * - `effect-pm prisma:print-schema` — print the canonical Prisma schema
 *   fragment to stdout (useful for `effect-pm prisma:print-schema > my.prisma`).
 * - `effect-pm prisma init` — interactively choose where to add the canonical
 *   Prisma schema fragment.
 * - `effect-pm add prisma [--separate-file|--no-separate-file] [--dry-run]` —
 *   detect the project's Prisma schema and add the effect-pm models.
 *
 * Keeps schema rewriting in a pure helper; this file supplies the Node CLI
 * bindings and optional prompt.
 *
 * @module bin/effect-pm
 */

import * as NodeFs from "node:fs";
import * as NodePath from "node:path";
import { createInterface } from "node:readline/promises";
import { prismaSchema } from "../prisma/schema";
import {
  addPrismaSchema,
  AddPrismaError,
  detectPrismaSchemaTargets,
  type AddPrismaOptions,
  type FsAdapter,
  type PrismaSchemaTarget,
} from "../prisma/setup";

const nodeFs: FsAdapter = {
  exists: (filepath) => NodeFs.existsSync(filepath),
  isDirectory: (filepath) => {
    try {
      return NodeFs.statSync(filepath).isDirectory();
    } catch {
      return false;
    }
  },
  readFile: (filepath) => NodeFs.readFileSync(filepath, "utf8"),
  writeFile: (filepath, contents) => {
    NodeFs.mkdirSync(NodePath.dirname(filepath), { recursive: true });
    NodeFs.writeFileSync(filepath, contents);
  },
  readdir: (dir) => NodeFs.readdirSync(dir),
};

const usage = `effect-pm — admin CLI

Usage:
  effect-pm prisma:print-schema
      Print the canonical Prisma schema fragment to stdout.

  effect-pm prisma init [--schema <path>] [--new-file <path>] [--dry-run]
      Add the effect-pm Prisma model to a schema. With no path flags, detects
      schema files and prompts you to append to one or create effect-pm.prisma
      when using Prisma's multi-file schema layout.

  effect-pm add prisma [--separate-file] [--no-separate-file] [--dry-run]
      Add the effect-pm Prisma models to your project's schema. Detects
      single-file (prisma/schema.prisma) and multi-file (prisma/schema/)
      layouts. Idempotent.

Flags:
  --separate-file       Force a separate effect-pm.prisma file (multi-file only).
  --no-separate-file    Force append to an existing schema file.
  --schema <path>       Append to an explicit schema file (prisma init only).
  --new-file <path>     Create an explicit schema file (prisma init only).
  --dry-run             Describe what would happen; do not write any files.
`;

const parseFlags = (argv: ReadonlyArray<string>): AddPrismaOptions => {
  const opts: { separateFile?: boolean; noSeparateFile?: boolean; dryRun?: boolean } =
    {};
  for (const arg of argv) {
    switch (arg) {
      case "--separate-file":
        opts.separateFile = true;
        break;
      case "--no-separate-file":
        opts.noSeparateFile = true;
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      default:
        process.stderr.write(`Unknown flag: ${arg}\n`);
        process.exit(2);
    }
  }
  return { cwd: process.cwd(), ...opts };
};

const parsePrismaInitOptions = (argv: ReadonlyArray<string>): AddPrismaOptions => {
  const opts: {
    schemaFile?: string;
    createFile?: string;
    dryRun?: boolean;
  } = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    switch (arg) {
      case "--schema": {
        const value = argv[index + 1];
        if (value === undefined) {
          process.stderr.write("--schema requires a path\n");
          process.exit(2);
        }
        opts.schemaFile = value;
        index++;
        break;
      }
      case "--new-file": {
        const value = argv[index + 1];
        if (value === undefined) {
          process.stderr.write("--new-file requires a path\n");
          process.exit(2);
        }
        opts.createFile = value;
        index++;
        break;
      }
      case "--dry-run":
        opts.dryRun = true;
        break;
      default:
        process.stderr.write(`Unknown flag: ${arg}\n`);
        process.exit(2);
    }
  }
  return { cwd: process.cwd(), ...opts };
};

const printAddPrismaResult = (
  result: ReturnType<typeof addPrismaSchema>,
): void => {
  if (result instanceof AddPrismaError) {
    process.stderr.write(`✗ ${result.reason}\n`);
    process.exit(1);
  }

  switch (result._tag) {
    case "AlreadyPresent":
      process.stdout.write(
        `✓ effect-pm models already present in ${result.schemaFile}. No changes.\n`,
      );
      return;
    case "DryRun":
      process.stdout.write(
        `dry-run: would write ${result.bytesPlanned} bytes via "${result.mode}" to ${result.schemaFile}\n`,
      );
      return;
    case "Wrote":
      process.stdout.write(
        `✓ wrote ${result.bytesWritten} bytes to ${result.schemaFile} (${result.mode}).\n`,
      );
      process.stdout.write(
        `  Next: run \`prisma migrate dev --name add_effect_pm_runtime_records\` (or \`prisma db push\` for prototyping), then \`prisma generate\`.\n`,
      );
      return;
  }
};

const runAddPrismaWithOptions = (options: AddPrismaOptions): void => {
  const result = addPrismaSchema(nodeFs, options);
  printAddPrismaResult(result);
};

const runAddPrisma = (argv: ReadonlyArray<string>): void => {
  runAddPrismaWithOptions(parseFlags(argv));
};

const runPrintSchema = (): void => {
  process.stdout.write(prismaSchema);
};

const targetLabel = (target: PrismaSchemaTarget): string =>
  target._tag === "Append"
    ? `Append to ${target.schemaFile}`
    : `Create ${target.schemaFile}`;

const promptPrismaTarget = (
  targets: ReadonlyArray<PrismaSchemaTarget>,
): Promise<PrismaSchemaTarget | undefined> => {
  process.stdout.write("Where should effect-pm add the Prisma model?\n");
  targets.forEach((target, index) => {
    process.stdout.write(`  ${index + 1}. ${targetLabel(target)}\n`);
  });
  process.stdout.write("  q. Cancel\n");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return rl.question("Select an option: ").then((answer) => {
    rl.close();
    const trimmed = answer.trim().toLowerCase();
    if (trimmed === "q" || trimmed === "quit" || trimmed === "cancel") {
      return undefined;
    }
    const selected = Number(trimmed);
    if (!Number.isInteger(selected) || selected < 1 || selected > targets.length) {
      process.stderr.write(`Invalid selection: ${answer}\n`);
      process.exit(2);
    }
    return targets[selected - 1];
  });
};

const runPrismaInit = (argv: ReadonlyArray<string>): Promise<void> => {
  const options = parsePrismaInitOptions(argv);
  if (options.schemaFile !== undefined || options.createFile !== undefined) {
    runAddPrismaWithOptions(options);
    return Promise.resolve();
  }

  const targets = detectPrismaSchemaTargets(nodeFs, { cwd: options.cwd });
  if (targets instanceof AddPrismaError) {
    process.stderr.write(`✗ ${targets.reason}\n`);
    process.exit(1);
  }
  if (targets.length === 0) {
    process.stderr.write("✗ no Prisma schema files detected.\n");
    process.exit(1);
  }

  return promptPrismaTarget(targets).then((target) => {
    if (target === undefined) {
      process.stdout.write("Cancelled.\n");
      return;
    }
    runAddPrismaWithOptions({
      cwd: options.cwd,
      dryRun: options.dryRun,
      ...(target._tag === "Append"
        ? { schemaFile: target.schemaFile }
        : { createFile: target.schemaFile }),
    });
  });
};

const main = (argv: ReadonlyArray<string>): Promise<void> | void => {
  const [first, ...rest] = argv;

  if (first === undefined || first === "--help" || first === "-h") {
    process.stdout.write(usage);
    return;
  }

  if (first === "prisma:print-schema") {
    if (rest.length > 0) {
      process.stderr.write(
        `prisma:print-schema does not accept arguments (got: ${rest.join(" ")})\n`,
      );
      process.exit(2);
    }
    runPrintSchema();
    return;
  }

  if (first === "prisma") {
    const [command, ...commandArgs] = rest;
    if (command !== "init") {
      process.stderr.write(`Unknown 'prisma' command: ${String(command)}\n`);
      process.exit(2);
    }
    return runPrismaInit(commandArgs);
  }

  if (first === "add") {
    const [target, ...flagArgs] = rest;
    if (target !== "prisma") {
      process.stderr.write(`Unknown 'add' target: ${String(target)}\n`);
      process.exit(2);
    }
    runAddPrisma(flagArgs);
    return;
  }

  process.stderr.write(`Unknown command: ${first}\n\n${usage}`);
  process.exit(2);
};

void Promise.resolve(main(process.argv.slice(2))).catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
