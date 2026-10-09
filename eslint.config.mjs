// Root ESLint flat config (playbook docs/04 §4.1: typescript-eslint strict-type-checked, security, jsx-a11y; --max-warnings=0).
// Every package runs `eslint . --max-warnings=0`; ESLint resolves this file from the package directory upwards.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import security from "eslint-plugin-security";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import nextPlugin from "@next/eslint-plugin-next";
import globals from "globals";

const ioModules = [
  "pg",
  "kysely",
  "fastify",
  "@fastify/*",
  "@aws-sdk/*",
  "openid-client",
  "undici",
  "node:fs",
  "node:fs/promises",
  "node:http",
  "node:https",
  "node:net",
  "node:child_process",
  "@anthropic-ai/sdk",
];

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/coverage/**",
      "**/src/gen/**",
      "**/.stryker-tmp/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/next-env.d.ts",
      "**/*.config.{js,mjs,cjs,ts,mts}",
      "**/stryker.config.mjs",
      "scripts/**",
      "docs/reference/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  security.configs.recommended,
  {
    languageOptions: {
      parserOptions: { projectService: true },
      globals: { ...globals.node },
    },
    rules: {
      "no-console": "error",
      "no-empty": ["error", { allowEmptyCatch: false }],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/ban-ts-comment": ["error", { "ts-expect-error": "allow-with-description" }],
      // security/detect-object-injection is noisy on typed record lookups; typed keys are enforced by TS instead.
      "security/detect-object-injection": "off",
    },
  },
  // ST-2 layering: domain code is pure — no I/O modules, no imports from http/ or data/ layers.
  {
    files: ["**/src/**/domain/**/*.ts", "packages/workflow/src/**/*.ts", "packages/document-parsing/src/rules/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ioModules, message: "Domain code must not import I/O modules (playbook ST-2/BE-1)." },
            {
              group: ["**/http/**", "**/data/**", "../http/*", "../data/*"],
              message: "Domain must not depend on http/ or data/ layers (BE-1).",
            },
          ],
        },
      ],
      "no-restricted-globals": ["error", { name: "fetch", message: "No I/O in domain code." }],
      "no-restricted-properties": ["error", { object: "Date", property: "now", message: "Inject a Clock (TD-4)." }],
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: "`new Date()` reads the wall clock: inject a Clock (TD-4).",
        },
        {
          selector: "CallExpression[callee.name='Date'][arguments.length=0]",
          message: "`Date()` reads the wall clock: inject a Clock (TD-4).",
        },
      ],
    },
  },
  // Config is parsed once (BE-2): process.env only in config.ts files.
  {
    files: ["services/**/src/**/*.ts", "packages/**/src/**/*.ts"],
    ignores: ["**/src/config.ts", "**/src/**/*.test.ts", "**/test/**", "packages/config/src/**", "**/src/testing.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        { object: "process", property: "env", message: "Read configuration via src/config.ts only (BE-2)." },
      ],
    },
  },
  // Frontend: React hooks, a11y, Next.js rules (FE-6..8).
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks, "jsx-a11y": jsxA11y, "@next/next": nextPlugin },
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.strict.rules,
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
    },
  },
  // The migration runner reads its own migrations directory (path fixed at build time, never user input).
  {
    files: ["packages/db/src/migrate.ts"],
    rules: { "security/detect-non-literal-fs-filename": "off" },
  },
  // openid-client's plain-HTTP switch is marked deprecated only "to stand out". The OIDC adapter uses it solely for the
  // local mock IdP over http; config refuses http outside APP_ENV=local and pins login.microsoftonline.com in staging and
  // production (ADR-0002). Only that one export is allowed, only in that one file; every other deprecation still fails.
  {
    files: ["services/api/src/modules/auth/http/oidc.ts"],
    rules: {
      "@typescript-eslint/no-deprecated": [
        "error",
        { allow: [{ from: "package", package: "openid-client", name: "allowInsecureRequests" }] },
      ],
    },
  },
  // Build/dev scripts run in Node with trusted, repo-relative paths.
  {
    files: ["**/scripts/**/*.ts"],
    rules: { "no-console": "off", "security/detect-non-literal-fs-filename": "off" },
  },
  {
    files: ["**/*.test.{ts,tsx}", "**/test/**/*.{ts,tsx}", "**/e2e/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "security/detect-non-literal-fs-filename": "off",
    },
  },
);
