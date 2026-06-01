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
 * - `effect-pm auth keygen` — generate a local Ed25519 command key pair and
 *   print/write the public registration record.
 *
 * Keeps schema rewriting in a pure helper; this file supplies the Node CLI
 * bindings and optional prompt.
 *
 * @module bin/effect-pm
 */

import * as NodeFs from "node:fs";
import * as NodePath from "node:path";
import { createInterface } from "node:readline/promises";
import { Effect } from "effect";
import { CommandAuth, type PublicKeyRecord } from "../CommandAuth";
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

interface AuthKeygenOptions {
  readonly name: string;
  readonly expiresAt: string;
  readonly privateKeyOut?: string;
  readonly publicRecordOut?: string;
}

const escapeJsonString = (value: string): string =>
  value.replace(/[\u0000-\u001f"\\]/g, (character) => {
    switch (character) {
      case "\"":
        return "\\\"";
      case "\\":
        return "\\\\";
      case "\b":
        return "\\b";
      case "\f":
        return "\\f";
      case "\n":
        return "\\n";
      case "\r":
        return "\\r";
      case "\t":
        return "\\t";
      default:
        return `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`;
    }
  });

const jsonString = (value: string): string => `"${escapeJsonString(value)}"`;

const publicKeyRecordJson = (record: PublicKeyRecord): string =>
  [
    "{",
    `  "keyId": ${jsonString(record.keyId)},`,
    `  "name": ${jsonString(record.name)},`,
    `  "algorithm": ${jsonString(record.algorithm)},`,
    `  "expiresAt": ${jsonString(record.expiresAt)},`,
    `  "publicKeyPem": ${jsonString(record.publicKeyPem)}`,
    "}",
  ].join("\n");

const writeFileSecure = (
  filepath: string,
  contents: string,
  mode?: number,
): void => {
  NodeFs.mkdirSync(NodePath.dirname(filepath), { recursive: true });
  NodeFs.writeFileSync(filepath, contents, mode === undefined ? undefined : { mode });
};

const requiredValue = (
  argv: ReadonlyArray<string>,
  index: number,
  flag: string,
): string => {
  const value = argv[index + 1];
  if (value === undefined) {
    process.stderr.write(`${flag} requires a value\n`);
    process.exit(2);
  }
  return value;
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

  effect-pm auth keygen --name <label> --expires <iso>
      Generate an Ed25519 command-auth key pair. Private key material is printed
      to stdout unless --private-key-out is provided. The public registration
      record is printed to stdout unless --public-record-out is provided.

Flags:
  --separate-file       Force a separate effect-pm.prisma file (multi-file only).
  --no-separate-file    Force append to an existing schema file.
  --schema <path>       Append to an explicit schema file (prisma init only).
  --new-file <path>     Create an explicit schema file (prisma init only).
  --dry-run             Describe what would happen; do not write any files.
  --name <label>        Human-readable command auth key label (auth keygen).
  --expires <iso>       Command auth key expiration timestamp (auth keygen).
  --private-key-out <path>
                        Write private key PEM to an explicit local path.
  --public-record-out <path>
                        Write public registration record JSON to a path.
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

const parseAuthKeygenOptions = (
  argv: ReadonlyArray<string>,
): AuthKeygenOptions => {
  const opts: {
    name?: string;
    expiresAt?: string;
    privateKeyOut?: string;
    publicRecordOut?: string;
  } = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    switch (arg) {
      case "--name":
        opts.name = requiredValue(argv, index, "--name");
        index++;
        break;
      case "--expires":
        opts.expiresAt = requiredValue(argv, index, "--expires");
        index++;
        break;
      case "--private-key-out":
        opts.privateKeyOut = requiredValue(argv, index, "--private-key-out");
        index++;
        break;
      case "--public-record-out":
        opts.publicRecordOut = requiredValue(argv, index, "--public-record-out");
        index++;
        break;
      default:
        process.stderr.write(`Unknown auth keygen flag: ${arg}\n`);
        process.exit(2);
    }
  }
  if (opts.name === undefined) {
    process.stderr.write("auth keygen requires --name <label>\n");
    process.exit(2);
  }
  if (opts.expiresAt === undefined) {
    process.stderr.write("auth keygen requires --expires <iso>\n");
    process.exit(2);
  }
  return {
    name: opts.name,
    expiresAt: opts.expiresAt,
    ...(opts.privateKeyOut === undefined ? {} : { privateKeyOut: opts.privateKeyOut }),
    ...(opts.publicRecordOut === undefined ? {} : { publicRecordOut: opts.publicRecordOut }),
  };
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

const runAuthKeygen = (argv: ReadonlyArray<string>): Promise<void> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const options = parseAuthKeygenOptions(argv);
      const keys = yield* CommandAuth.generateEd25519KeyPair({
        name: options.name,
        expiresAt: options.expiresAt,
      });
      const publicRecord = `${publicKeyRecordJson(keys.publicKey)}\n`;

      if (options.privateKeyOut === undefined) {
        process.stdout.write("# Private command auth key. Store locally; do not commit.\n");
        process.stdout.write(`EFFECT_PM_COMMAND_KEY_ID=${keys.privateKey.keyId}\n`);
        process.stdout.write(`EFFECT_PM_COMMAND_KEY_NAME=${keys.privateKey.name}\n`);
        process.stdout.write(`EFFECT_PM_COMMAND_KEY_EXPIRES_AT=${keys.privateKey.expiresAt}\n`);
        process.stdout.write(keys.privateKey.privateKeyPem);
      } else {
        writeFileSecure(options.privateKeyOut, keys.privateKey.privateKeyPem, 0o600);
        process.stdout.write(`wrote private key PEM to ${options.privateKeyOut}\n`);
        process.stdout.write(`EFFECT_PM_COMMAND_KEY_ID=${keys.privateKey.keyId}\n`);
        process.stdout.write(`EFFECT_PM_COMMAND_KEY_NAME=${keys.privateKey.name}\n`);
        process.stdout.write(`EFFECT_PM_COMMAND_KEY_EXPIRES_AT=${keys.privateKey.expiresAt}\n`);
        process.stdout.write(`EFFECT_PM_COMMAND_PRIVATE_KEY_FILE=${options.privateKeyOut}\n`);
      }

      if (options.publicRecordOut === undefined) {
        process.stdout.write("\n# Public command auth registration record.\n");
        process.stdout.write(publicRecord);
      } else {
        writeFileSecure(options.publicRecordOut, publicRecord);
        process.stdout.write(`wrote public key record to ${options.publicRecordOut}\n`);
      }
    }),
  );

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

  if (first === "auth") {
    const [command, ...commandArgs] = rest;
    if (command !== "keygen") {
      process.stderr.write(`Unknown 'auth' command: ${String(command)}\n`);
      process.exit(2);
    }
    return runAuthKeygen(commandArgs);
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
