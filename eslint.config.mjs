import tseslint from "typescript-eslint";
import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

// The React / browser layer — `src/web` (dashboard) and `src/tui` (Ink). These are UI, not
// Effect-domain code, so (1) the Effect-purity diagnostics are relaxed for them in their own tsconfig
// (src/web/tsconfig.json — see docs/getting-started/install "Diagnostic rulesets"), and (2) here they
// get the React eslint ruleset: eslint-plugin-react + react-hooks (rules-of-hooks / exhaustive-deps) +
// browser globals. Modeled on wow-sports' @shared/eslint-config/react-internal.
const reactFiles = ["src/web/**/*.{ts,tsx}", "src/tui/**/*.{ts,tsx}"];

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "repos/**",
      "archive/**",
      // Agent worktrees live here; without ignoring them (and pinning tsconfigRootDir below) their
      // nested repo checkout adds a second candidate root and typescript-eslint fails to parse anything.
      ".claude/**"
    ]
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: [
      "*.{ts,tsx}",
      "src/**/*.{ts,tsx}",
      "test/**/*.{ts,tsx}",
      "examples/**/*.{ts,tsx}",
      "dev/**/*.{ts,tsx}",
      "scripts/**/*.{ts,tsx}",
      "packages/last-ts/**/*.{ts,tsx}",
      "docs/**/*.{ts,tsx}",
    ],
    languageOptions: {
      ...config.languageOptions,
      parserOptions: {
        ...config.languageOptions?.parserOptions,
        // Pin the root explicitly: a `.claude/worktrees/*` checkout otherwise makes tsconfigRootDir
        // ambiguous and every file fails to parse (the enforcer silently stops running).
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      ...config.rules,
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-namespace": "off",
      // An empty interface that extends a single type is a legitimate pattern (nominal aliasing and,
      // for `StoreShapeTree`, breaking a `type`-alias circular reference — see internal/store/contractDef).
      "@typescript-eslint/no-empty-object-type": ["error", { allowInterfaces: "with-single-extends" }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_"
        }
      ]
    }
  })),
  {
    // Type-level assertion files: bare expressions ARE the test, and scratch
    // type names are the fixtures — the value-level hygiene rules don't apply.
    files: ["**/*.test-d.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-unused-expressions": "off"
    }
  },
  {
    // Twoslash source for docs/guides/view-typed-jsx.md: the trailing bare expression
    // carries the `// ^?` hover query that renders the type popover — it IS the doc.
    files: ["examples/ui/view-typed-jsx/App.tsx"],
    rules: {
      "@typescript-eslint/no-unused-expressions": "off"
    }
  },
  // ── React / browser layer ruleset ────────────────────────────────────────────────────────────
  {
    ...pluginReact.configs.flat.recommended,
    files: reactFiles,
    languageOptions: {
      ...pluginReact.configs.flat.recommended.languageOptions,
      // `.tsx` is TypeScript — use the tseslint parser (the default espree can't parse TS/JSX).
      parser: tseslint.parser,
      parserOptions: {
        ...pluginReact.configs.flat.recommended.languageOptions?.parserOptions,
        ecmaFeatures: { jsx: true },
        tsconfigRootDir: import.meta.dirname
      },
      globals: {
        ...globals.browser,
        ...globals.serviceworker
      }
    },
    // Pin the version (not "detect"): eslint-plugin-react 7's auto-detect crashes under ESLint 10.
    settings: { react: { version: "19.0" } }
  },
  {
    files: reactFiles,
    plugins: { "react-hooks": pluginReactHooks },
    rules: {
      // The classic React-hooks rules (the set wow-sports' react-internal enforces via plugin v5).
      // v7's `recommended` also ships experimental rules (static-components / incompatible-library /
      // use-memo) that fight reactivity libraries like effect-atom, so we don't spread it wholesale.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // The new JSX transform makes `import React` unnecessary in scope.
      "react/react-in-jsx-scope": "off",
      // TypeScript props interfaces are the prop contract; runtime PropTypes are not used here.
      "react/prop-types": "off"
    }
  },
  // F5 split-dial + no direct waku (merged — flat config replaces the whole rule).
  {
    files: ["src/ui/**/*.{ts,tsx}", "src/web/**/*.{ts,tsx}", "src/tui/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "../Node",
              importNames: ["connect", "connectHttp", "connectSocket", "connectIpc"],
              message:
                "F5 split-dial: provide Hyperlink.ws / Node.connect* in Atom.runtime and yield* the Node — do not re-dial from the tag url (docs/handoffs/loud-failures-design.md §10)."
            },
            {
              name: "../../Node",
              importNames: ["connect", "connectHttp", "connectSocket", "connectIpc"],
              message:
                "F5 split-dial: provide Hyperlink.ws / Node.connect* in Atom.runtime and yield* the Node — do not re-dial from the tag url (docs/handoffs/loud-failures-design.md §10)."
            },
            {
              name: "hyperlink-ts/Node",
              importNames: ["connect", "connectHttp", "connectSocket", "connectIpc"],
              message:
                "F5 split-dial: provide Hyperlink.ws / Node.connect* in Atom.runtime and yield* the Node — do not re-dial from the tag url (docs/handoffs/loud-failures-design.md §10)."
            },
            {
              name: "waku",
              message:
                "Do not import waku in apps. Use last-ts/config, last-ts/server, last-ts/Waku, last-ts/vite. waku is an optional peer of last-ts only.",
            },
          ],
          patterns: [
            {
              group: ["waku/*"],
              message:
                "Do not import waku/* in apps. Use last-ts/config, last-ts/server, last-ts/Waku, last-ts/vite. waku is an optional peer of last-ts only.",
            },
          ],
        },
      ],
    },
  },
  // App trees never import waku — optional peer of last-ts only (see no-waku-app-imports).
  // docs/site cut over to last-ts host façades (Server.fromPage / Page.make) — no grandfather.
  {
    files: ["**/*.{ts,tsx,js,mjs,cjs}"],
    ignores: [
      "packages/last-ts/**",
      "repos/**",
      "node_modules/**",
      "dist/**",
      "src/ui/**",
      "src/web/**",
      "src/tui/**",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "waku",
              message:
                "Do not import waku in apps. Use last-ts/config, last-ts/server, last-ts/Waku, last-ts/vite. waku is an optional peer of last-ts only.",
            },
          ],
          patterns: [
            {
              group: ["waku/*"],
              message:
                "Do not import waku/* in apps. Use last-ts/config, last-ts/server, last-ts/Waku, last-ts/vite. waku is an optional peer of last-ts only.",
            },
          ],
        },
      ],
    },
  },
];
