"""
Settlement-math tests — the highest-value tests in this codebase. The
balance + greedy logic is what users actually trust; a regression here
is "people pay the wrong friend" / "balance never closes". Every other
feature builds on these primitives being correct.
"""
import pytest

from modules.expense_tracker.service import compute_balances, greedy_settle


# ── helpers ─────────────────────────────────────────────────────────────

def member(mid, name="x"): return {"id": mid, "display_name": name}

def expense(payer, amount, splits, payments=None):
    """Build an expense dict in the shape compute_balances() reads."""
    return {
        "payer_id": payer,
        "amount":   amount,
        "splits":   splits,
        "payments": payments,
    }

def split(member_id, share): return {"member_id": member_id, "share": share}
def payment(member_id, amt): return {"member_id": member_id, "amount": amt}


# ── compute_balances ───────────────────────────────────────────────────

class TestComputeBalances:
    def test_empty(self):
        bs = compute_balances([member("a"), member("b")], [])
        assert all(b["paid"] == 0 and b["owed"] == 0 and b["net"] == 0 for b in bs)

    def test_single_payer_equal_split(self):
        # A pays 100, split equally between A and B → each owes 50
        # Net: A = 100 paid - 50 share = +50. B = 0 paid - 50 share = -50.
        bs = compute_balances(
            [member("a"), member("b")],
            [expense("a", 100, [split("a", 50), split("b", 50)])],
        )
        bm = {b["member_id"]: b for b in bs}
        assert bm["a"]["net"] == 50
        assert bm["b"]["net"] == -50
        # Sum of nets is always zero — no money created/destroyed.
        assert sum(b["net"] for b in bs) == 0

    def test_multi_payer(self):
        # Bill is 40. A paid 16, B paid 24. Split equally → 20 each.
        # Net: A = 16 - 20 = -4. B = 24 - 20 = +4.
        bs = compute_balances(
            [member("a"), member("b")],
            [expense("a", 40,
                     splits=[split("a", 20), split("b", 20)],
                     payments=[payment("a", 16), payment("b", 24)])],
        )
        bm = {b["member_id"]: b for b in bs}
        assert bm["a"]["net"] == -4
        assert bm["b"]["net"] == 4

    def test_legacy_single_payer_falls_back_when_payments_missing(self):
        # An expense with no `payments` list falls back to (payer_id, amount).
        # Equivalent to single-payer, must produce the same balances.
        bs = compute_balances(
            [member("a"), member("b")],
            [expense("a", 100, [split("a", 50), split("b", 50)], payments=None)],
        )
        bm = {b["member_id"]: b for b in bs}
        assert bm["a"]["net"] == 50
        assert bm["b"]["net"] == -50

    def test_unequal_splits_with_drift(self):
        # 100 split as 33.33 + 33.33 + 33.34 — payer is third member.
        bs = compute_balances(
            [member("a"), member("b"), member("c")],
            [expense("c", 100, [split("a", 33.33), split("b", 33.33), split("c", 33.34)])],
        )
        bm = {b["member_id"]: b for b in bs}
        assert bm["a"]["net"] == pytest.approx(-33.33, abs=0.01)
        assert bm["b"]["net"] == pytest.approx(-33.33, abs=0.01)
        # Third member: paid 100, owes 33.34 → +66.66.
        assert bm["c"]["net"] == pytest.approx(66.66, abs=0.01)

    def test_settlements_close_the_loop(self):
        # A owes B 50 after one expense. Settle 50 → both should be even.
        members  = [member("a"), member("b")]
        expenses = [expense("b", 100, [split("a", 50), split("b", 50)])]
        before = {b["member_id"]: b["net"] for b in compute_balances(members, expenses)}
        assert before == {"a": -50, "b": 50}

        after = compute_balances(
            members, expenses,
            settlements=[{"from_member_id": "a", "to_member_id": "b", "amount": 50}],
        )
        assert all(b["net"] == 0 for b in after)

    def test_partial_settlement(self):
        # Settle only half — remaining 25 stays open.
        members  = [member("a"), member("b")]
        expenses = [expense("b", 100, [split("a", 50), split("b", 50)])]
        bs = compute_balances(
            members, expenses,
            settlements=[{"from_member_id": "a", "to_member_id": "b", "amount": 25}],
        )
        bm = {b["member_id"]: b for b in bs}
        assert bm["a"]["net"] == -25
        assert bm["b"]["net"] == 25


# ── greedy_settle ──────────────────────────────────────────────────────

class TestGreedySettle:
    def test_empty(self):
        assert greedy_settle([]) == []

    def test_already_settled(self):
        bs = [{"member_id": "a", "net": 0}, {"member_id": "b", "net": 0}]
        assert greedy_settle(bs) == []

    def test_single_pair(self):
        bs = [{"member_id": "a", "net": -50}, {"member_id": "b", "net": 50}]
        ts = greedy_settle(bs)
        assert len(ts) == 1
        assert ts[0]["from_member_id"] == "a"
        assert ts[0]["to_member_id"]   == "b"
        assert ts[0]["amount"]         == 50

    def test_three_members_n_minus_one_transfers(self):
        # Classic 3-person case: A owes 50, B owes 30, C is owed 80.
        # Greedy must produce ≤ N-1 = 2 transfers.
        bs = [
            {"member_id": "a", "net": -50},
            {"member_id": "b", "net": -30},
            {"member_id": "c", "net":  80},
        ]
        ts = greedy_settle(bs)
        assert len(ts) <= 2
        # Every transfer should go *to* C (the only creditor).
        assert all(t["to_member_id"] == "c" for t in ts)
        # Sum of payments == sum of debts.
        assert sum(t["amount"] for t in ts) == pytest.approx(80, abs=0.01)

    def test_skips_dust(self):
        # Sub-cent rounding noise should NOT generate transfers.
        bs = [
            {"member_id": "a", "net": -0.001},
            {"member_id": "b", "net":  0.001},
        ]
        assert greedy_settle(bs) == []

    def test_unbalanced_input_does_not_crash(self):
        # If somehow nets don't sum to zero (bad data), greedy still
        # produces a sensible plan up to the smaller side and stops.
        bs = [
            {"member_id": "a", "net": -10},
            {"member_id": "b", "net":  100},  # creditor with no matching debtors
        ]
        ts = greedy_settle(bs)
        assert sum(t["amount"] for t in ts) == 10  # only what could be settled


# ── round-trip: balances → greedy → settled balances == 0 ──────────────

def test_compute_then_greedy_zeros_out():
    """Property test: applying every greedy transfer as a settlement
    should leave every member at net=0. This is the contract that
    matters end-to-end."""
    members = [member("a"), member("b"), member("c"), member("d")]
    expenses = [
        # A pays for everyone; equal 4-way split of 100.
        expense("a", 100, [split(m["id"], 25) for m in members]),
        # B pays a 60 dinner shared by B, C only (custom split).
        expense("b", 60, [split("b", 30), split("c", 30)]),
        # C pays a 40 cab back, equal 4-way split of 10 each.
        expense("c", 40, [split(m["id"], 10) for m in members]),
    ]
    bs = compute_balances(members, expenses)
    settlements = [
        {"from_member_id": t["from_member_id"], "to_member_id": t["to_member_id"], "amount": t["amount"]}
        for t in greedy_settle(bs)
    ]
    after = compute_balances(members, expenses, settlements=settlements)
    for b in after:
        assert abs(b["net"]) < 0.05, f"member {b['member_id']} not settled: net={b['net']}"
