import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "prisma/index": "src/prisma/index.ts",
    "bin/effect-pm": "src/bin/effect-pm.ts",
  },
  format: ["cjs", "esm"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  outDir: "dist",
  external: [
    // Optional peer — never bundle.
    "@prisma/client",
  ],
});
