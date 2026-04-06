"""
Smart allocation logic — pure functions, no Flask/DB imports.
Compatible with Python 3.8+.
"""
from datetime import date, timedelta
from typing import List, Dict, Optional


def compute(
    cards: List[Dict],
    accounts: List[Dict],
    receivables: List[Dict],
    capex_items: List[Dict],
    rent_amount: float,
) -> Dict:
    today = date.today()

    balances: Dict[str, float] = {a["id"]: float(a["balance"]) for a in accounts}

    acc_by_bank: Dict[str, List[Dict]] = {}
    for acc in accounts:
        acc_by_bank.setdefault(acc["bank"], []).append(acc)

    sorted_cards = sorted(cards, key=lambda c: c["due_date_offset"])
    allocations = []

    for card in sorted_cards:
        amount = float(card["outstanding"])
        bank   = card.get("bank", "")

        candidates = (
            acc_by_bank.get(bank, [])
            + [a for a in accounts if a["bank"] != bank and a["bank"] != "Cash"]
        )
        chosen: Optional[Dict] = next(
            (a for a in candidates if balances[a["id"]] >= amount),
            None,
        )
        if chosen is None:
            chosen = max(accounts, key=lambda a: balances[a["id"]], default=None)

        if chosen:
            balances[chosen["id"]] -= amount
            due_date = today + timedelta(days=card["due_date_offset"])
            allocations.append({
                "card":      card["name"],
                "amount":    amount,
                "pay_from":  chosen["name"],
                "due_date":  due_date.isoformat(),
                "days_left": card["due_date_offset"],
                "feasible":  balances[chosen["id"]] >= 0,
            })

    post_balances = [
        {
            "account":   a["name"],
            "original":  float(a["balance"]),
            "remaining": balances[a["id"]],
        }
        for a in accounts
    ]

    total_liquid      = sum(float(a["balance"]) for a in accounts)
    total_cc          = sum(float(c["outstanding"]) for c in cards)
    total_receivables = sum(float(r["amount"]) for r in receivables)
    total_capex       = sum(float(i["amount"]) for i in capex_items)
    net_after_cc      = total_liquid - total_cc - rent_amount
    cash_flow_gap     = net_after_cc + total_receivables - total_capex

    return {
        "allocations":   allocations,
        "post_balances": post_balances,
        "summary": {
            "total_liquid":         total_liquid,
            "total_cc_outstanding": total_cc,
            "rent":                 rent_amount,
            "net_after_cc":         net_after_cc,
            "total_receivables":    total_receivables,
            "total_capex":          total_capex,
            "cash_flow_gap":        cash_flow_gap,
        },
    }
