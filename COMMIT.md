# CI fix 1 — api route-completeness world and getOperation 404, worker Teams integration tests and fake, web bundle budgets

11 files. Commit message:

fix(worker): treat an open Graph circuit as unavailable; fix Teams integration tests and the Graph fake

route-completeness runs its world with the Teams flag on (its routes answer 404 by design when off).
getOperation answers 404, as its contract declares, for a global operation the caller may not read.
The fake reports parentReference.path on every item (the poll handler resolves folders by it) and seeds
folders by intent rather than by name (template folders carry dots). An open circuit now counts as
"Teams unavailable" (retry later) in push, provision and poll instead of a per-file refusal. Push
expectations include the new `deleted` count; the throttling test injects one attempt's worth of 429s;
the poll test seeds the job's checkpoint rows like a real job; the scheduler test isolates its due work.
apps/web/.size-limit.mjs: the lazy-JS guard moves 307 → 330 KB for the three lazily loaded Teams screens
(319.5 KB) and the all-routes first-load union 170 → 172 KB (170.1 KB; the largest route is 166.7 KB, within
FE-9's 170 KB per route, which is unchanged). Performance-sensitive: aggregate budgets re-based, per-route not. CM

AI-Agent: claude.ai/claude-fable-5.1
Refs: WP-25
