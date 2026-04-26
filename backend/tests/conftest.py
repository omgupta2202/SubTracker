"""
Shared pytest fixtures.

The tests here are deliberately scoped to PURE-FUNCTION business logic
(balance computation, greedy settlement, drift validation) — these don't
need a Postgres connection, run in milliseconds, and catch the highest-
value bugs (settlement math errors).

Route-level integration tests would need a real DB or a fake one; we
defer those until they're actually needed.
"""
import sys, os

# Add backend root to sys.path so `from modules.expense_tracker import service`
# works without installing the package.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
