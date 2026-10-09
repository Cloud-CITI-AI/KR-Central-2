<!-- managed-by: agentic-playbook v1.0.0 — copy into a PR comment or release ticket and fill. Status: ✅ done · ❌ gap (link issue) · n/a (reason) -->

# Security checklist — <<service / release>>

Reviewer: @________ Date: ________ ASVS target level: L2 / L3

## A. Pre-commit (developer machine / agent sandbox)

| ID    | Control                                                                    | ASVS 5.0 / OWASP 2025            | Status |
| ----- | -------------------------------------------------------------------------- | -------------------------------- | ------ |
| SC-A1 | gitleaks hook installed and passing                                        | V13 Configuration · A02          |        |
| SC-A2 | No `.env` or credential files staged; `.env.example` has placeholders only | V13 · A02                        |        |
| SC-A3 | Agent session ran in sandbox with no production credentials                | ASI03 Identity & Privilege Abuse |        |

## B. Pull request

| ID     | Control                                                                                     | Mapping                            | Status |
| ------ | ------------------------------------------------------------------------------------------- | ---------------------------------- | ------ |
| SC-B1  | All new inputs validated with schema at the boundary (type, length, range, format)          | V2 Validation · A05 Injection      |        |
| SC-B2  | All queries parameterised; no string-built SQL, shell or HTML                               | V1 Encoding & Sanitization · A05   |        |
| SC-B3  | Every new/changed handler has explicit authorisation, deny by default, tenant/owner scoping | V8 Authorization · A01             |        |
| SC-B4  | Authentication flows use the shared identity library; no custom crypto or token parsing     | V6 Authentication, V9 Tokens · A07 |        |
| SC-B5  | Errors return problem+json without stack traces; failures fail closed                       | V16 Logging & Error Handling · A10 |        |
| SC-B6  | Logs contain no secrets, tokens or personal data; security events logged                    | V16 · A09                          |        |
| SC-B7  | Outbound requests use allowlisted hosts; user-supplied URLs validated (SSRF)                | V15 / V12 · A01                    |        |
| SC-B8  | New dependencies justified; dependency review passes (no high/critical, licence allowed)    | V15 Secure Coding · A03            |        |
| SC-B9  | Frontend: no unsanitised HTML; CSP and security headers unchanged or tightened              | V3 Web Frontend · A02              |        |
| SC-B10 | Personal data: classified, minimised, encrypted at rest/in transit, retention defined       | V14 Data Protection · A04          |        |
| SC-B11 | CodeQL, gitleaks, dependency review, zizmor (workflows), IaC scan: zero new high/critical   | —                                  |        |
| SC-B12 | Agent PR: no protected-path changes; "Suspicious content" section reviewed                  | ASI01 Goal Hijack                  |        |

## C. Pre-release

| ID    | Control                                                                 | Mapping                       | Status |
| ----- | ----------------------------------------------------------------------- | ----------------------------- | ------ |
| SC-C1 | Container image scan: no fixable high/critical                          | A03                           |        |
| SC-C2 | SBOM generated and attested; build provenance attested (SLSA Build L2+) | A03, A08                      |        |
| SC-C3 | DAST baseline (ZAP) on staging: no high alerts                          | A02, A05                      |        |
| SC-C4 | Secrets for this release in the secret manager, rotated within policy   | V13                           |        |
| SC-C5 | Threat model updated if trust boundaries changed                        | V15 Secure Architecture · A06 |        |

## D. Runtime

| ID    | Control                                                        | Mapping                  | Status |
| ----- | -------------------------------------------------------------- | ------------------------ | ------ |
| SC-D1 | Workload identity / OIDC; no long-lived cloud keys             | V13 · ASI03              |        |
| SC-D2 | TLS 1.2+ everywhere; HSTS on public endpoints                  | V12 Secure Communication |        |
| SC-D3 | Rate limiting and request size limits on public endpoints      | V2, V4 API               |        |
| SC-D4 | Alerts on auth failures, authz denials spikes, 5xx, WAF blocks | V16 · A09                |        |
| SC-D5 | Runbook links incident response contacts and kill switch       | —                        |        |

## E. Agent-specific (per repo, reviewed quarterly)

| ID    | Control                                                                                      | Mapping                                 | Status |
| ----- | -------------------------------------------------------------------------------------------- | --------------------------------------- | ------ |
| SC-E1 | Agent identities are separate bot/app accounts with least privilege; cannot approve or merge | ASI03                                   |        |
| SC-E2 | Claude Code managed settings: sandbox required, deny rules for secrets; Copilot firewall on  | ASI02 Tool Misuse, ASI05 Code Execution |        |
| SC-E3 | No agent session combines private data + untrusted content + egress (lethal trifecta)        | ASI01                                   |        |
| SC-E4 | MCP servers allowlisted, pinned, reviewed; no write-scoped tokens to external systems        | ASI04 Supply Chain                      |        |
| SC-E5 | Instruction files protected (CODEOWNERS, hook, guard)                                        | ASI06 Memory & Context Poisoning        |        |
| SC-E6 | Kill switch tested this quarter (date: ____)                                                 | ASI10 Rogue Agents                      |        |
