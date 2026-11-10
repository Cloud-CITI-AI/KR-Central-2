# KR Central — e2e fixes (29 files). Delete this file before committing.

Subject:
fix(web): KR Central shell — accessible names when folded, footer landmark, externals to their jobs, e2e for the new routes

Description:
Found by the first full e2e run of the KR Central shell.

- Sidebar labels stay in the accessibility tree when the sidebar is folded or on a
  phone (they were display:none, so the icon links had no name: WCAG link-name).
- The shell footer is a <footer> outside <main> again (contentinfo landmark).
- Clients and architects go straight to /subdivisions after sign-in; Home is for
  KR people.
- Archiving a job returns to /subdivisions?archived=… so the banner shows.
- Dashboard rows: restored the bar transition (off under reduced motion) and
  wrapping of long client names.
- Not-found and error pages: the title is the page's h1; outside the shell they
  use the public frame. The feedback link is passed from the server layout only.
- The sidebar fold button no longer carries aria-expanded (the Save as PDF check
  counts expanded stage buttons).
- E2E specs: dashboard at /subdivisions, links scoped to main or the admin nav,
  "KR Central home", Home after a staff sign-in.
- Lazy JS budget 335 → 340 KB.

Visual snapshot baselines still need re-recording for the new look (see the
workflow in the chat message).

AI-Agent: claude.ai/claude-fable-5.1
Refs: WP-25
