# KR Central — the new shell, home page, theme and rebrand (85 files)

Unzip over your clone (on top of the Teams work already on main). Nothing is deleted except that the old hero header
component and the SignedInShell are no longer used: they stay in the tree, unused, and can be removed in a follow-up.
Delete this COMMIT.md before committing.

## Commit message

feat(web): KR Central shell — floating sidebar, home page, photo wash, light and dark themes, sign-in rebrand

The app is KR Central, KR Surveys' operations portal; the Subdivision Tracker is its first module. A floating,
collapsible sidebar (KR mark, Home, Modules → Subdivision Tracker with the needs-attention count, Admin pages by
capability, user block with theme buttons and sign-out) replaces the photo hero header; breadcrumbs above each page;
the KR site photo as a pale wash behind the canvas, darker in dark mode. New Home at / (greeting, the finding, module
tiles with live counts, "Needs you"); the dashboard moves to /subdivisions. Design tokens rebuilt on a chroma-free
neutral ramp with orange (action) and blue (KR, links) as the brand hues, light and dark. Dashboard rows instead of
cards, flat panels, typed progress figure, status marks instead of tinted blocks, a job heading on the tracker.
Sign-in, signed-out and sign-in-problem pages on one card over the wash. Yantramanav self-hosted (no Google Fonts at
build or run time). FE-9 moves from 170 to 190 KB per route (the shell rides in every first load); spec, README and the
staff guide updated. E2E specs updated for the shell and route (they run in CI).

AI-Agent: claude.ai/claude-fable-5.1
Refs: WP-25

## Evidence (agent sandbox)
pnpm lint → 0 · pnpm typecheck → 0 · pnpm format:check → clean · design-tokens tests 10/10 (WCAG contrast)
apps/web: production build succeeds (local fonts); perf:check passes at the re-based budgets; unit suites green:
  app 69, components/lib/notes/viewer/conditions 479, dashboard/admin/tracker 274, access/checkpoints/files/teams/home 320
Screenshots in the redesign-screenshots folder were taken from this build running against a fake API with synthetic data.
Not run here: e2e (Playwright) and visual snapshots — CI; expect the visual snapshot baseline to need re-recording.
