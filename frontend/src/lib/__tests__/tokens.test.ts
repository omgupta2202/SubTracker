import { describe, it, expect } from "vitest";
import { inrCompact, relativeTime } from "../tokens";

describe("inrCompact", () => {
  it("formats sub-1k as plain rupees", () => {
    expect(inrCompact(0)).toContain("0");
    expect(inrCompact(999)).toMatch(/₹/);
  });
  it("uses k for 4-figure amounts", () => {
    expect(inrCompact(12_345)).toMatch(/k$/);
  });
  it("uses L (lakh) for 100k+", () => {
    expect(inrCompact(2_50_000)).toMatch(/L$/);
  });
  it("uses Cr (crore) for 1cr+", () => {
    expect(inrCompact(3_50_00_000)).toMatch(/Cr$/);
  });
  it("handles null/NaN cleanly", () => {
    expect(inrCompact(null as any)).toBe("—");
    expect(inrCompact(NaN)).toBe("—");
  });
  it("preserves sign", () => {
    expect(inrCompact(-1000)).toMatch(/^−/);
  });
});

describe("relativeTime", () => {
  it("returns seconds for very recent", () => {
    expect(relativeTime(new Date(Date.now() - 5_000).toISOString())).toMatch(/^[1-9]+s ago$/);
  });
  it("returns minutes for sub-hour", () => {
    expect(relativeTime(new Date(Date.now() - 5 * 60 * 1000).toISOString())).toMatch(/^5m ago$/);
  });
  it("returns hours for sub-day", () => {
    expect(relativeTime(new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString())).toMatch(/^3h ago$/);
  });
  it("returns days for sub-week", () => {
    expect(relativeTime(new Date(Date.now() - 2 * 86_400_000).toISOString())).toMatch(/^2d ago$/);
  });
  it("returns absolute date past a week", () => {
    const longAgo = new Date(Date.now() - 60 * 86_400_000).toISOString();
    // Should NOT match the relative format anymore.
    expect(relativeTime(longAgo)).not.toMatch(/ago$/);
  });
  it("handles missing input", () => {
    expect(relativeTime(null)).toBe("—");
    expect(relativeTime(undefined)).toBe("—");
    expect(relativeTime("not a date")).toBe("—");
  });
});
