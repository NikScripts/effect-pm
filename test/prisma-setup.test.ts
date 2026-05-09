import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  addPrismaSchema,
  AddPrismaError,
  type FsAdapter,
} from "../src/prisma/setup";
import {
  prismaSchema,
  prismaSchemaModelMarker,
} from "../src/prisma/schema";

const makeMemoryFs = (
  initial: Record<string, string | null>,
): FsAdapter & { snapshot: () => Record<string, string | null> } => {
  // `null` means a directory entry (no contents).
  const files = new Map<string, string | null>(
    Object.entries(initial).map(([key, value]) => [path.normalize(key), value]),
  );

  const exists = (filepath: string) => files.has(path.normalize(filepath));
  const isDirectory = (filepath: string) =>
    files.get(path.normalize(filepath)) === null;
  const readFile = (filepath: string) => {
    const v = files.get(path.normalize(filepath));
    if (v === null || v === undefined) {
      throw new Error(`memfs: not a file: ${filepath}`);
    }
    return v;
  };
  const writeFile = (filepath: string, contents: string) => {
    const normalized = path.normalize(filepath);
    files.set(normalized, contents);
    let dir = path.dirname(normalized);
    while (dir && dir !== path.dirname(dir)) {
      if (!files.has(dir)) files.set(dir, null);
      dir = path.dirname(dir);
    }
  };
  const readdir = (dir: string) => {
    const normalized = path.normalize(dir);
    const prefix = normalized.endsWith(path.sep)
      ? normalized
      : `${normalized}${path.sep}`;
    const entries = new Set<string>();
    for (const key of files.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const head = rest.split(path.sep)[0];
      if (head !== undefined && head !== "") {
        entries.add(head);
      }
    }
    return Array.from(entries);
  };
  const snapshot = () => Object.fromEntries(files.entries());
  return { exists, isDirectory, readFile, writeFile, readdir, snapshot };
};

describe("addPrismaSchema — single-file layout", () => {
  it("appends the schema fragment to schema.prisma", () => {
    const cwd = "/proj";
    const schemaPath = path.join(cwd, "prisma", "schema.prisma");
    const fs = makeMemoryFs({
      [schemaPath]: "datasource db { provider = \"sqlite\"; url = \"file:./dev.db\" }\n",
    });
    const result = addPrismaSchema(fs, { cwd });
    expect("_tag" in result && result._tag).toBe("Wrote");
    if ("_tag" in result && result._tag === "Wrote") {
      expect(result.mode).toBe("single-file");
      expect(result.schemaFile).toBe(schemaPath);
    }
    expect(fs.readFile(schemaPath)).toContain(prismaSchemaModelMarker);
  });

  it("is idempotent if the model is already declared", () => {
    const cwd = "/proj";
    const schemaPath = path.join(cwd, "prisma", "schema.prisma");
    const fs = makeMemoryFs({
      [schemaPath]: prismaSchema,
    });
    const result = addPrismaSchema(fs, { cwd });
    expect("_tag" in result && result._tag).toBe("AlreadyPresent");
  });

  it("rejects --separate-file in single-file layouts", () => {
    const cwd = "/proj";
    const schemaPath = path.join(cwd, "prisma", "schema.prisma");
    const fs = makeMemoryFs({
      [schemaPath]: "datasource db { provider = \"sqlite\" }\n",
    });
    const result = addPrismaSchema(fs, { cwd, separateFile: true });
    expect(result).toBeInstanceOf(AddPrismaError);
  });

  it("dry-run reports planned write without modifying files", () => {
    const cwd = "/proj";
    const schemaPath = path.join(cwd, "prisma", "schema.prisma");
    const before = "datasource db { provider = \"sqlite\" }\n";
    const fs = makeMemoryFs({ [schemaPath]: before });
    const result = addPrismaSchema(fs, { cwd, dryRun: true });
    expect("_tag" in result && result._tag).toBe("DryRun");
    expect(fs.readFile(schemaPath)).toBe(before);
  });
});

describe("addPrismaSchema — multi-file layout", () => {
  it("creates effect-pm.prisma in the schema folder by default", () => {
    const cwd = "/proj";
    const dir = path.join(cwd, "prisma", "schema");
    const userSchema = path.join(dir, "main.prisma");
    const fs = makeMemoryFs({
      [dir]: null,
      [userSchema]: "datasource db { provider = \"sqlite\" }\n",
    });
    const result = addPrismaSchema(fs, { cwd });
    expect("_tag" in result && result._tag).toBe("Wrote");
    if ("_tag" in result && result._tag === "Wrote") {
      expect(result.mode).toBe("multi-file-separate");
      expect(result.schemaFile).toBe(path.join(dir, "effect-pm.prisma"));
    }
    expect(fs.readFile(path.join(dir, "effect-pm.prisma"))).toContain(
      prismaSchemaModelMarker,
    );
    expect(fs.readFile(userSchema)).toBe(
      "datasource db { provider = \"sqlite\" }\n",
    );
  });

  it("appends to the first existing file under --no-separate-file", () => {
    const cwd = "/proj";
    const dir = path.join(cwd, "prisma", "schema");
    const userSchema = path.join(dir, "main.prisma");
    const before = "datasource db { provider = \"sqlite\" }\n";
    const fs = makeMemoryFs({
      [dir]: null,
      [userSchema]: before,
    });
    const result = addPrismaSchema(fs, { cwd, noSeparateFile: true });
    expect("_tag" in result && result._tag).toBe("Wrote");
    if ("_tag" in result && result._tag === "Wrote") {
      expect(result.mode).toBe("multi-file-append");
      expect(result.schemaFile).toBe(userSchema);
    }
    expect(fs.readFile(userSchema)).toContain(prismaSchemaModelMarker);
  });

  it("fails with a tagged error when no Prisma schema is present", () => {
    const fs = makeMemoryFs({});
    const result = addPrismaSchema(fs, { cwd: "/empty" });
    expect(result).toBeInstanceOf(AddPrismaError);
    if (result instanceof AddPrismaError) {
      expect(result.reason).toContain("no Prisma schema detected");
    }
  });

  it("rejects --separate-file together with --no-separate-file", () => {
    const cwd = "/proj";
    const dir = path.join(cwd, "prisma", "schema");
    const userSchema = path.join(dir, "main.prisma");
    const fs = makeMemoryFs({
      [dir]: null,
      [userSchema]: "// empty\n",
    });
    const result = addPrismaSchema(fs, {
      cwd,
      separateFile: true,
      noSeparateFile: true,
    });
    expect(result).toBeInstanceOf(AddPrismaError);
  });
});
