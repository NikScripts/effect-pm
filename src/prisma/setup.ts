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
  /**
   * Append to this explicit schema file instead of using automatic layout rules.
   */
  readonly schemaFile?: string;
  /**
   * Create this explicit schema file instead of using automatic layout rules.
   */
  readonly createFile?: string;
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

/**
 * Candidate destination for the effect-pm Prisma schema fragment.
 *
 * @public
 */
export type PrismaSchemaTarget =
  | {
      readonly _tag: "Append";
      readonly schemaFile: string;
    }
  | {
      readonly _tag: "Create";
      readonly schemaFile: string;
    };

const joinPath = (...parts: ReadonlyArray<string>): string =>
  parts
    .join("/")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");

const detectLayout = (
  fs: FsAdapter,
  cwd: string,
): DetectedLayout | AddPrismaError => {
  const schemaDir = joinPath(cwd, "prisma", "schema");
  const singleFile = joinPath(cwd, "prisma", "schema.prisma");

  if (fs.exists(schemaDir) && fs.isDirectory(schemaDir)) {
    const files = fs
      .readdir(schemaDir)
      .filter((entry) => entry.endsWith(".prisma"))
      .sort()
      .map((entry) => joinPath(schemaDir, entry));
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

/**
 * List schema files an interactive CLI can offer for appending / creation.
 *
 * @public
 */
export const detectPrismaSchemaTargets = (
  fs: FsAdapter,
  options: { readonly cwd: string },
): ReadonlyArray<PrismaSchemaTarget> | AddPrismaError => {
  const layout = detectLayout(fs, options.cwd);
  if (layout instanceof AddPrismaError) return layout;

  const appendTargets = layout.existingSchemaFiles.map((schemaFile): PrismaSchemaTarget => ({
    _tag: "Append",
    schemaFile,
  }));

  if (layout.kind === "multi-file") {
    return [
      ...appendTargets,
      {
        _tag: "Create",
        schemaFile: joinPath(layout.target, "effect-pm.prisma"),
      },
    ];
  }

  return appendTargets;
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
  if (options.separateFile === true && options.noSeparateFile === true) {
    return new AddPrismaError({
      cwd: options.cwd,
      reason: "--separate-file and --no-separate-file are mutually exclusive.",
    });
  }
  if (options.schemaFile !== undefined && options.createFile !== undefined) {
    return new AddPrismaError({
      cwd: options.cwd,
      reason: "--schema and --new-file are mutually exclusive.",
    });
  }

  if (options.schemaFile !== undefined) {
    const schemaFile = options.schemaFile;
    if (!fs.exists(schemaFile)) {
      return new AddPrismaError({
        cwd: options.cwd,
        reason: `schema file does not exist: ${schemaFile}`,
      });
    }
    if (fs.readFile(schemaFile).includes(prismaSchemaModelMarker)) {
      return { _tag: "AlreadyPresent", schemaFile };
    }
    const fragment = `\n${prismaSchema}`;
    if (options.dryRun === true) {
      return {
        _tag: "DryRun",
        mode: "multi-file-append",
        schemaFile,
        bytesPlanned: fragment.length,
      };
    }
    const next = fs.readFile(schemaFile) + fragment;
    fs.writeFile(schemaFile, next);
    return {
      _tag: "Wrote",
      mode: "multi-file-append",
      schemaFile,
      bytesWritten: fragment.length,
    };
  }

  if (options.createFile !== undefined) {
    const schemaFile = options.createFile;
    if (fs.exists(schemaFile)) {
      if (fs.readFile(schemaFile).includes(prismaSchemaModelMarker)) {
        return { _tag: "AlreadyPresent", schemaFile };
      }
      return new AddPrismaError({
        cwd: options.cwd,
        reason: `refusing to overwrite existing schema file: ${schemaFile}`,
      });
    }
    if (options.dryRun === true) {
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
    if (options.separateFile === true) {
      return new AddPrismaError({
        cwd: options.cwd,
        reason:
          "--separate-file requires the multi-file schema layout (prisma/schema/). Move your schema into a folder first or drop the flag.",
      });
    }
    const schemaFile = layout.target;
    const fragment = `\n${prismaSchema}`;
    if (options.dryRun === true) {
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
  const useSeparate = options.noSeparateFile === true ? false : true;
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
    if (options.dryRun === true) {
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

  const schemaFile = `${layout.target}/effect-pm.prisma`;
  if (fs.exists(schemaFile)) {
    if (fs.readFile(schemaFile).includes(prismaSchemaModelMarker)) {
      return { _tag: "AlreadyPresent", schemaFile };
    }
    return new AddPrismaError({
      cwd: options.cwd,
      reason: `refusing to overwrite existing schema file: ${schemaFile}`,
    });
  }
  if (options.dryRun === true) {
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
