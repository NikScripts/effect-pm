#!/usr/bin/env node
/**
 * Admin CLI for `effect-pm`.
 *
 * @remarks
 * Currently exposes:
 *
 * - `effect-pm prisma:print-schema` — print the canonical Prisma schema
 *   fragment to stdout (useful for `effect-pm prisma:print-schema > my.prisma`).
 * - `effect-pm add prisma [--separate-file|--no-separate-file] [--dry-run]` —
 *   detect the project's Prisma schema and add the effect-pm models.
 *
 * Kept dependency-free (only `node:fs` / `node:path`) so it does not pull the
 * Effect runtime into npm's bin output.
 *
 * @module bin/effect-pm
 */

import fs from "node:fs";
import path from "node:path";
import { prismaSchema } from "../prisma/schema";
import {
  addPrismaSchema,
  AddPrismaError,
  type AddPrismaOptions,
  type FsAdapter,
} from "../prisma/setup";

const nodeFs: FsAdapter = {
  exists: (filepath) => fs.existsSync(filepath),
  isDirectory: (filepath) => {
    try {
      return fs.statSync(filepath).isDirectory();
    } catch {
      return false;
    }
  },
  readFile: (filepath) => fs.readFileSync(filepath, "utf8"),
  writeFile: (filepath, contents) => {
    fs.mkdirSync(path.dirname(filepath), { recursive: true });
    fs.writeFileSync(filepath, contents, "utf8");
  },
  readdir: (dir) => fs.readdirSync(dir),
};

const usage = `effect-pm — admin CLI

Usage:
  effect-pm prisma:print-schema
      Print the canonical Prisma schema fragment to stdout.

  effect-pm add prisma [--separate-file] [--no-separate-file] [--dry-run]
      Add the effect-pm Prisma models to your project's schema. Detects
      single-file (prisma/schema.prisma) and multi-file (prisma/schema/)
      layouts. Idempotent.

Flags:
  --separate-file       Force a separate effect-pm.prisma file (multi-file only).
  --no-separate-file    Force append to an existing schema file.
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

const runAddPrisma = (argv: ReadonlyArray<string>): void => {
  const options = parseFlags(argv);
  const result = addPrismaSchema(nodeFs, options);
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
        `  Next: run \`prisma migrate dev --name add_effect_pm_event\` (or \`prisma db push\` for prototyping).\n`,
      );
      return;
  }
};

const runPrintSchema = (): void => {
  process.stdout.write(prismaSchema);
};

const main = (argv: ReadonlyArray<string>): void => {
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

main(process.argv.slice(2));
