import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "repos/**"
    ]
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ["src/**/*.ts", "test/**/*.ts", "examples/**/*.ts"],
    rules: {
      ...config.rules,
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-namespace": "off",
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
    files: ["test/**/*.test-d.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-empty-object-type": "off"
    }
  }
];
