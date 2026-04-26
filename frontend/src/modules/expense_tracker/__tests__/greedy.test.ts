import { describe, it, expect } from "vitest";
import { greedyDebt } from "../ExpenseTrackerApp";

/** Mirror of the backend `greedy_settle` tests — the frontend has its
 *  own implementation that has to behave identically (it's used in the
 *  guest route's "settle up" panel since guests can't call the
 *  authenticated /settlement endpoint). If these two diverge, owner and
 *  guest see different settlement plans for the same data — silent bug. */
describe("greedyDebt", () => {
  it("returns nothing when everyone is settled", () => {
    expect(greedyDebt([
      { member_id: "a", net: 0 },
      { member_id: "b", net: 0 },
    ])).toEqual([]);
  });

  it("ignores sub-cent dust", () => {
    expect(greedyDebt([
      { member_id: "a", net: -0.001 },
      { member_id: "b", net:  0.001 },
    ])).toEqual([]);
  });

  it("produces one transfer for a single pair", () => {
    const ts = greedyDebt([
      { member_id: "a", net: -50 },
      { member_id: "b", net:  50 },
    ]);
    expect(ts).toHaveLength(1);
    expect(ts[0]).toMatchObject({ from: "a", to: "b", amount: 50 });
  });

  it("uses ≤ N−1 transfers for N members", () => {
    const ts = greedyDebt([
      { member_id: "a", net: -50 },
      { member_id: "b", net: -30 },
      { member_id: "c", net:  80 },
    ]);
    expect(ts.length).toBeLessThanOrEqual(2);
    // Sum of payments matches the sum of debts.
    expect(ts.reduce((s, t) => s + t.amount, 0)).toBeCloseTo(80, 2);
  });

  it("doesn't crash on unbalanced input", () => {
    const ts = greedyDebt([
      { member_id: "a", net: -10 },
      { member_id: "b", net: 100 },
    ]);
    expect(ts.reduce((s, t) => s + t.amount, 0)).toBeCloseTo(10, 2);
  });
});
