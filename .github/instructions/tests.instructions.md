---
applyTo: "**/*.test.ts,**/*.test.tsx,**/*.spec.ts,**/tests/**/*.py,**/test_*.py"
---

<!-- managed-by: agentic-playbook v1.0.0 -->

- Every test must be able to fail: assert on outputs and side effects, not only that a function was called.
- Name tests by behaviour: `it("returns 404 when the order belongs to another tenant")`.
- No `.only`, `.skip`, `xit`, `pytest.mark.skip` without a linked issue in the same line.
- Repository and migration tests use the real database via Testcontainers; never mock the database client.
- No sleeps for synchronisation; use the framework's waiting utilities.
