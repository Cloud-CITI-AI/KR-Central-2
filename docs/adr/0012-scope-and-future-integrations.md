# ADR-0012: Scope — developer-note requirements in, SharePoint sync / ePlanning / website embed deferred

- Status: proposed
- Date: 2026-10-09
- Deciders: KR Surveys (Craig) — pending; drafted for review
- Drafted by: agent claude (orchestrator) for the launching human
- Related: docs/spec/PRODUCT_SPEC.md §13, §16; ADR-0015 (supersedes the SharePoint/Teams paragraph)

## Context

The prototype's temporary "Developer notes" list five requests. The customer asked to keep scope to the job at hand
while thinking about what may have been missed.

## Decision

- In scope now: (1) access manager for KR staff only, clients/architects get access to their job; (2) KR Admin role with
  fee-proposal visibility.
- Deferred, designed for:
  - ~~**SharePoint/Teams folder sync** — phase 2 worker operation `sharepoint.sync` using Microsoft Graph (Sites.Selected),
    reusing the zip folder layout as the folder structure; needs job → Teams channel mapping and admin consent.~~
    **Superseded by ADR-0015** (2026-10-27): three phases — (1) Graph connector, hand link to an existing channel,
    the app's stage/checkpoint folders mirrored into the channel's `102. Subdivision Tracker` folder and one-way push
    of clean files; (2) two-way sync; (3) the app creates the channel at job creation.
  - **ePlanning watcher** — WAPC ePlanning has no public webhook; requires an official API or scraping (legal/ToS review).
  - **Website embed** — serve on a KR subdomain and link from krsurveys.com.au; iframe embedding would weaken
    `frame-ancestors` and break SameSite cookies in some browsers.
- Also deferred: notifications (email/Teams when an action is the client's), import from KR's project tracker,
  invoice amounts/payments, e-signatures.
- Removed: the "Developer notes" box itself (the prototype says to remove it before going live).

## Consequences

Each deferred item needs its own brief and ADR (new external hosts — X7).

## Compliance check

Work packages contain no deferred items; PRODUCT_SPEC §16 lists them.
