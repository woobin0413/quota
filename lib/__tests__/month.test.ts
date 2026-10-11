import { describe, it, expect } from "vitest";
import { startOfMonthUTC } from "@/lib/billing/month";

describe("startOfMonthUTC", () => {
  it("returns the first instant of the month in UTC", () => {
    const d = startOfMonthUTC(new Date("2026-08-20T18:37:31Z"));
    expect(d.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });
  it("is idempotent on the first of the month", () => {
    const d = startOfMonthUTC(new Date("2026-08-01T00:00:00Z"));
    expect(d.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });
  it("handles year boundary (January)", () => {
    const d = startOfMonthUTC(new Date("2026-01-05T12:00:00Z"));
    expect(d.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});
