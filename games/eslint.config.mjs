import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/.cache/**", "playwright-report/**", "test-results/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  {
    // The mechanics core must stay engine-agnostic: no DOM, no Web Audio, no timers from the host.
    files: ["packages/mechanics/src/**/*.ts"],
    ignores: ["**/*.test.ts"],
    languageOptions: { globals: {} },
    rules: {
      "no-restricted-globals": [
        "error",
        ...["window", "document", "navigator", "localStorage", "AudioContext", "fetch", "requestAnimationFrame"].map(
          (name) => ({ name, message: "packages/mechanics is engine-agnostic; inject this through an adapter." }),
        ),
      ],
    },
  },
);
