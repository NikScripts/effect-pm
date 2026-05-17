import * as NodePath from "@effect/platform-node/NodePath";
import { Effect, Path } from "effect";
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

const withPath = <A>(f: (p: Path.Path) => A): A =>
  Effect.runSync(
    Effect.gen(function* () {
      const pth = yield* Path.Path;
      return f(pth);
    }).pipe(Effect.provide(NodePath.layer)),
  );

const normalize = (filepath: string) =>
  withPath((pth) => pth.normalize(filepath));
const dirname = (filepath: string) =>
  withPath((pth) => pth.dirname(filepath));
const sep = withPath((pth) => pth.sep);
const join = (...parts: ReadonlyArray<string>) =>
  withPath((pth) => pth.join(...parts));

const makeMemoryFs = (
  initial: Record<string, string | null>,
): FsAdapter & { snapshot: () => Record<string, string | null> } => {
  // `null` means a directory entry (no contents).
  const files = new Map<string, string | null>(
    Object.entries(initial).map(([key, value]) => [normalize(key), value]),
  );

  const exists = (filepath: string) => files.has(normalize(filepath));
  const isDirectory = (filepath: string) =>
    files.get(normalize(filepath)) === null;
  const readFile = (filepath: string) => {
    const v = files.get(normalize(filepath));
    if (v === null || v === undefined) {
      throw new Error(`memfs: not a file: ${filepath}`);
    }
    return v;
  };
  const writeFile = (filepath: string, contents: string) => {
    const normalized = normalize(filepath);
    files.set(normalized, contents);
    let dir = dirname(normalized);
    while (dir.length > 0 && dir !== dirname(dir)) {
      if (!files.has(dir)) files.set(dir, null);
      dir = dirname(dir);
    }
  };
  const readdir = (dir: string) => {
    const normalized = normalize(dir);
    const prefix = normalized.endsWith(sep)
      ? normalized
      : `${normalized}${sep}`;
    const entries = new Set<string>();
    for (const key of files.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const head = rest.split(sep)[0];
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
    const schemaPath = join(cwd, "prisma", "schema.prisma");
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
    const schemaPath = join(cwd, "prisma", "schema.prisma");
    const fs = makeMemoryFs({
      [schemaPath]: prismaSchema,
    });
    const result = addPrismaSchema(fs, { cwd });
    expect("_tag" in result && result._tag).toBe("AlreadyPresent");
  });

  it("rejects --separate-file in single-file layouts", () => {
    const cwd = "/proj";
    const schemaPath = join(cwd, "prisma", "schema.prisma");
    const fs = makeMemoryFs({
      [schemaPath]: "datasource db { provider = \"sqlite\" }\n",
    });
    const result = addPrismaSchema(fs, { cwd, separateFile: true });
    expect(result).toBeInstanceOf(AddPrismaError);
  });

  it("dry-run reports planned write without modifying files", () => {
    const cwd = "/proj";
    const schemaPath = join(cwd, "prisma", "schema.prisma");
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
    const dir = join(cwd, "prisma", "schema");
    const userSchema = join(dir, "main.prisma");
    const fs = makeMemoryFs({
      [dir]: null,
      [userSchema]: "datasource db { provider = \"sqlite\" }\n",
    });
    const result = addPrismaSchema(fs, { cwd });
    expect("_tag" in result && result._tag).toBe("Wrote");
    if ("_tag" in result && result._tag === "Wrote") {
      expect(result.mode).toBe("multi-file-separate");
      expect(result.schemaFile).toBe(join(dir, "effect-pm.prisma"));
    }
    expect(fs.readFile(join(dir, "effect-pm.prisma"))).toContain(
      prismaSchemaModelMarker,
    );
    expect(fs.readFile(userSchema)).toBe(
      "datasource db { provider = \"sqlite\" }\n",
    );
  });

  it("appends to the first existing file under --no-separate-file", () => {
    const cwd = "/proj";
    const dir = join(cwd, "prisma", "schema");
    const userSchema = join(dir, "main.prisma");
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
    const dir = join(cwd, "prisma", "schema");
    const userSchema = join(dir, "main.prisma");
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
