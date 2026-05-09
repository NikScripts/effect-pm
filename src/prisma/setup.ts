/**
 * Pure logic for the `effect-pm add prisma` schema rewriter.
 *
 * @remarks
 * This module is filesystem-free: callers pass an explicit
 * {@link FsAdapter}. That makes the rewriter unit-testable with an in-memory
 * adapter and keeps the Node binding thin.
 *
 * @module ProcessStore/Prisma/Setup
 */

import path from "node:path";
import { Data } from "effect";
import { prismaSchema, prismaSchemaModelMarker } from "./schema";

// ============================================================================
// Filesystem adapter
// ============================================================================

/**
 * Filesystem operations the rewriter requires.
 *
 * @remarks
 * Production callers pass a thin wrapper over `node:fs`. Tests pass an
 * in-memory implementation.
 *
 * @public
 */
export interface FsAdapter {
  exists: (filepath: string) => boolean;
  isDirectory: (filepath: string) => boolean;
  readFile: (filepath: string) => string;
  writeFile: (filepath: string, contents: string) => void;
  /** List directory entries (file + dir names, not full paths). */
  readdir: (dir: string) => ReadonlyArray<string>;
}

// ============================================================================
// Inputs / outputs
// ============================================================================

/**
 * Configuration accepted by the rewriter.
 *
 * @public
 */
export interface AddPrismaOptions {
  /**
   * Project root used to resolve `prisma/` paths.
   *
   * @defaultValue `process.cwd()`
   */
  readonly cwd: string;
  /**
   * Force the rewriter to write a separate `effect-pm.prisma` file when the
   * project is using Prisma's multi-file schema layout.
   */
  readonly separateFile?: boolean;
  /**
   * Force the rewriter to append to an existing schema file even when the
   * project supports the multi-file layout.
   */
  readonly noSeparateFile?: boolean;
  /**
   * If `true`, do not write any files; only describe what would happen.
   */
  readonly dryRun?: boolean;
}

/**
 * Outcome of running the rewriter.
 *
 * @public
 */
export type AddPrismaResult =
  | {
      readonly _tag: "Wrote";
      readonly mode: "single-file" | "multi-file-separate" | "multi-file-append";
      readonly schemaFile: string;
      readonly bytesWritten: number;
    }
  | {
      readonly _tag: "AlreadyPresent";
      readonly schemaFile: string;
    }
  | {
      readonly _tag: "DryRun";
      readonly mode: "single-file" | "multi-file-separate" | "multi-file-append";
      readonly schemaFile: string;
      readonly bytesPlanned: number;
    };

/**
 * Raised when the rewriter cannot continue (e.g. no Prisma schema detected,
 * or conflicting flags).
 *
 * @public
 */
export class AddPrismaError extends Data.TaggedError("AddPrismaError")<{
  readonly reason: string;
  readonly cwd: string;
}> {}

// ============================================================================
// Detection
// ============================================================================

interface DetectedLayout {
  readonly kind: "single-file" | "multi-file";
  /** For single-file: the schema.prisma path. For multi-file: the schema dir. */
  readonly target: string;
  /** Existing `.prisma` files in scope. */
  readonly existingSchemaFiles: ReadonlyArray<string>;
}

const detectLayout = (
  fs: FsAdapter,
  cwd: string,
): DetectedLayout | AddPrismaError => {
  const schemaDir = path.join(cwd, "prisma", "schema");
  const singleFile = path.join(cwd, "prisma", "schema.prisma");

  if (fs.exists(schemaDir) && fs.isDirectory(schemaDir)) {
    const files = fs
      .readdir(schemaDir)
      .filter((entry) => entry.endsWith(".prisma"))
      .map((entry) => path.join(schemaDir, entry));
    return {
      kind: "multi-file",
      target: schemaDir,
      existingSchemaFiles: files,
    };
  }

  if (fs.exists(singleFile)) {
    return {
      kind: "single-file",
      target: singleFile,
      existingSchemaFiles: [singleFile],
    };
  }

  return new AddPrismaError({
    cwd,
    reason:
      "no Prisma schema detected. Looked for prisma/schema.prisma and prisma/schema/. Run `prisma init` first or pass --schema <path>.",
  });
};

// ============================================================================
// Rewriter
// ============================================================================

/**
 * Decide where to put the effect-pm schema fragment and apply it.
 *
 * @public
 */
export const addPrismaSchema = (
  fs: FsAdapter,
  options: AddPrismaOptions,
): AddPrismaResult | AddPrismaError => {
  if (options.separateFile && options.noSeparateFile) {
    return new AddPrismaError({
      cwd: options.cwd,
      reason: "--separate-file and --no-separate-file are mutually exclusive.",
    });
  }

  const layout = detectLayout(fs, options.cwd);
  if (layout instanceof AddPrismaError) return layout;

  // Idempotency — if any existing schema file already declares the model,
  // skip without rewriting.
  for (const file of layout.existingSchemaFiles) {
    if (fs.readFile(file).includes(prismaSchemaModelMarker)) {
      return { _tag: "AlreadyPresent", schemaFile: file };
    }
  }

  if (layout.kind === "single-file") {
    if (options.separateFile) {
      return new AddPrismaError({
        cwd: options.cwd,
        reason:
          "--separate-file requires the multi-file schema layout (prisma/schema/). Move your schema into a folder first or drop the flag.",
      });
    }
    const schemaFile = layout.target;
    const fragment = `\n${prismaSchema}`;
    if (options.dryRun) {
      return {
        _tag: "DryRun",
        mode: "single-file",
        schemaFile,
        bytesPlanned: fragment.length,
      };
    }
    const next = fs.readFile(schemaFile) + fragment;
    fs.writeFile(schemaFile, next);
    return {
      _tag: "Wrote",
      mode: "single-file",
      schemaFile,
      bytesWritten: fragment.length,
    };
  }

  // multi-file
  const useSeparate = options.noSeparateFile ? false : true;
  if (!useSeparate) {
    const target = layout.existingSchemaFiles[0];
    if (target === undefined) {
      return new AddPrismaError({
        cwd: options.cwd,
        reason:
          "multi-file schema directory is empty. Add at least one .prisma file first or drop --no-separate-file.",
      });
    }
    const fragment = `\n${prismaSchema}`;
    if (options.dryRun) {
      return {
        _tag: "DryRun",
        mode: "multi-file-append",
        schemaFile: target,
        bytesPlanned: fragment.length,
      };
    }
    const next = fs.readFile(target) + fragment;
    fs.writeFile(target, next);
    return {
      _tag: "Wrote",
      mode: "multi-file-append",
      schemaFile: target,
      bytesWritten: fragment.length,
    };
  }

  const schemaFile = path.join(layout.target, "effect-pm.prisma");
  if (options.dryRun) {
    return {
      _tag: "DryRun",
      mode: "multi-file-separate",
      schemaFile,
      bytesPlanned: prismaSchema.length,
    };
  }
  fs.writeFile(schemaFile, prismaSchema);
  return {
    _tag: "Wrote",
    mode: "multi-file-separate",
    schemaFile,
    bytesWritten: prismaSchema.length,
  };
};
