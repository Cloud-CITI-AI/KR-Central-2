# ADR-0010: Optional Claude vision for reading the conformance stamp, behind a feature flag

- Status: proposed
- Date: 2026-10-09
- Deciders: KR Surveys (Craig) — pending; drafted for review
- Drafted by: agent claude (orchestrator) for the launching human
- Related: docs/spec/PRODUCT_SPEC.md, ADR-0006

## Context

The prototype read the WAPC Conformance Notification's stamped date (an image inside the PDF) with a Claude vision call
from the browser. Page 1 may contain personal data (applicant names, addresses). Sending documents to a third party
needs customer consent and is a new external host (X7).

## Decision

- Feature flag `ai-stamp-reading` (env `FEATURE_AI_STAMP_READING`, default **off**; owner: KR Surveys; review date:
  2027-04-01) plus `ANTHROPIC_API_KEY` (worker only). When off, the reading falls through from file name → stamp
  annotation → text rule → manual entry (always available).
- When on, the worker renders page 1 only to PNG (scale 3) and calls the Anthropic Messages API with the official
  TypeScript SDK (`@anthropic-ai/sdk`), model **`claude-sonnet-5-5`** (`ANTHROPIC_MODEL`), structured outputs
  (`client.messages.parse` with `output_config.format = zodOutputFormat({date, stampText, found})`), `max_tokens` ~1024,
  timeout 30 s, no retries beyond the SDK default, low effort. The prompt is the prototype's (find the "DEPARTMENT OF
  PLANNING, LANDS AND HERITAGE" stamp box DATE). The response date is validated as a real ISO date; `stop_reason`
  `refusal` or invalid output ⇒ treated as "not found". The UI asks users to check the date.
- Data handling: only the page-1 image is sent, no file names or user data; Anthropic API data retention per KR's
  agreement; documented in the privacy notice.

## Options considered

| Option                                        | Pros                                          | Cons                                                 |
| --------------------------------------------- | --------------------------------------------- | ---------------------------------------------------- |
| Optional Claude vision behind a flag (chosen) | Keeps the prototype capability, consent-gated | External dependency when on                          |
| Local OCR (tesseract)                         | No data leaves                                | Poor accuracy on stamps; heavy image; new dependency |
| Manual entry only                             | Simplest                                      | Loses a valued prototype feature                     |

## Consequences

Cost is negligible (one small image per notification). Turning the flag off has no other effect.

## Compliance check

Worker unit tests with a mocked Anthropic client (no network in unit tests); flag listed in docs/flags.md with owner and
removal/review date (CF-4).
