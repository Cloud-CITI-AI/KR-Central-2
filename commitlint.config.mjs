// Conventional Commits (playbook A3). Trailers (AI-Agent:, Refs:) are checked by playbook-guard in CI.
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": [
      2,
      "always",
      [
        "repo",
        "web",
        "api",
        "worker",
        "workflow",
        "contracts",
        "design-tokens",
        "config",
        "logger",
        "storage",
        "mock-idp",
        "db",
        "document-parsing",
        "telemetry",
        "infra",
        "ci",
        "docs",
        "deps",
        "auth",
        "security",
      ],
    ],
    "body-max-line-length": [0],
    "footer-max-line-length": [0],
  },
};
