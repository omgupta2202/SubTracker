"""
EMI math — interest/principal split, outstanding, foreclosure savings.

Uses the standard reducing-balance EMI formula:
  EMI = P * r * (1+r)^n / ((1+r)^n - 1)
where P=principal, r=monthly rate (annual%/12/100), n=total installments.

Given the loan parameters and the number of installments already paid,
returns a dict with:
  outstanding_principal     — what the user owes today
  interest_paid_to_date     — interest already paid across `completed` EMIs
  principal_paid_to_date    — principal already retired
  total_interest_over_loan  — interest over the full term, if run to completion
  foreclosure_savings       — interest saved if user prepays outstanding today
                               (= remaining_emi_payments - outstanding_principal)
  scheduled_remaining       — sum of remaining scheduled EMI payments

If interest_rate is missing or zero, treats the loan as zero-interest and
returns a flat split (principal_paid = EMI * completed). All values are
returned as floats for JSON serialization.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Optional, Union


def compute_emi_math(
    *,
    emi_amount: Optional[Union[float, Decimal]],
    principal: Optional[Union[float, Decimal]],
    annual_rate_pct: Optional[Union[float, Decimal]],
    total_installments: Optional[int],
    completed_installments: Optional[int],
) -> dict:
    emi = float(emi_amount or 0)
    P   = float(principal or 0)
    n   = int(total_installments or 0)
    k   = max(0, min(int(completed_installments or 0), n))
    annual = float(annual_rate_pct or 0)

    if emi <= 0 or n <= 0:
        return _empty(emi, n, k)

    # Zero-interest loan — flat split.
    if annual <= 0 or P <= 0:
        scheduled_remaining = emi * (n - k)
        principal_paid = min(P, emi * k) if P > 0 else emi * k
        outstanding = max(0.0, P - principal_paid) if P > 0 else emi * (n - k)
        return {
            "outstanding_principal":     round(outstanding, 2),
            "interest_paid_to_date":     0.0,
            "principal_paid_to_date":    round(principal_paid, 2),
            "total_interest_over_loan":  0.0,
            "scheduled_remaining":       round(scheduled_remaining, 2),
            "foreclosure_savings":       round(scheduled_remaining - outstanding, 2),
        }

    r = annual / 12.0 / 100.0  # monthly rate

    # Total interest over the full term = (EMI × n) − P.
    total_interest = max(0.0, emi * n - P)

    # Outstanding principal after k payments (closed-form).
    # B_k = P*(1+r)^k − EMI*((1+r)^k − 1)/r
    factor = (1 + r) ** k
    outstanding = P * factor - emi * (factor - 1) / r
    outstanding = max(0.0, outstanding)

    principal_paid = max(0.0, P - outstanding)
    interest_paid  = max(0.0, emi * k - principal_paid)
    scheduled_remaining = emi * (n - k)
    foreclosure_savings = max(0.0, scheduled_remaining - outstanding)

    return {
        "outstanding_principal":     round(outstanding, 2),
        "interest_paid_to_date":     round(interest_paid, 2),
        "principal_paid_to_date":    round(principal_paid, 2),
        "total_interest_over_loan":  round(total_interest, 2),
        "scheduled_remaining":       round(scheduled_remaining, 2),
        "foreclosure_savings":       round(foreclosure_savings, 2),
    }


def _empty(emi: float, n: int, k: int) -> dict:
    return {
        "outstanding_principal":     0.0,
        "interest_paid_to_date":     0.0,
        "principal_paid_to_date":    round(emi * k, 2),
        "total_interest_over_loan":  0.0,
        "scheduled_remaining":       round(emi * max(0, n - k), 2),
        "foreclosure_savings":       0.0,
    }
