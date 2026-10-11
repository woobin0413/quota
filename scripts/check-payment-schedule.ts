/**
 * Ad-hoc checks for lib/payment-schedule (no test framework in repo).
 * Run: npx tsx scripts/check-payment-schedule.ts
 */
import {
  computeMilestoneAmounts,
  deriveMilestoneViews,
  validateSchedule,
  DEFAULT_SCHEDULE,
} from "../lib/payment-schedule";
import type { PaymentMilestone, QuotePayment } from "../types/database";

let failures = 0;
function check(name: string, cond: boolean) {
  if (!cond) {
    failures++;
    console.error("FAIL:", name);
  }
}

// rounding: 10/30/30/30 of an awkward total sums exactly
{
  const amounts = computeMilestoneAmounts(6973.09, [10, 30, 30, 30]);
  const sum = amounts.reduce((s, a) => s + Math.round(a * 100), 0);
  check("amounts sum to total", sum === 697309);
  check("deposit is 10%", amounts[0] === 697.31);
}

// last milestone absorbs remainder on a 3-way split
{
  const amounts = computeMilestoneAmounts(100, [33.33, 33.33, 33.34]);
  const sum = amounts.reduce((s, a) => s + Math.round(a * 100), 0);
  check("3-way split sums to 100.00", sum === 10000);
}

const mk = (id: string, pct: number, sort: number): PaymentMilestone => ({
  id,
  quote_id: "q1",
  user_id: "u1",
  name: id,
  percentage: pct,
  sort_order: sort,
});
const pay = (milestoneId: string, amount: number): QuotePayment => ({
  id: `p-${milestoneId}-${amount}`,
  quote_id: "q1",
  milestone_id: milestoneId,
  user_id: "u1",
  amount,
  paid_at: "2026-07-12",
  method: null,
  note: null,
  receipt_sent_at: null,
  receipt_sent_count: 0,
  created_at: new Date(),
});

// status derivation: unpaid / partial / paid (±1¢)
{
  const ms = [mk("a", 10, 0), mk("b", 90, 1)];
  const views = deriveMilestoneViews(ms, [pay("a", 50), pay("b", 900)], 1000);
  check("partial milestone", views[0].status === "partial");
  check("paid milestone", views[1].status === "paid");
  const none = deriveMilestoneViews(ms, [], 1000);
  check("unpaid milestone", none[0].status === "unpaid");
}

// guards
{
  const ms = [mk("a", 10, 0), mk("b", 90, 1)];
  const views = deriveMilestoneViews(ms, [pay("a", 100)], 1000);

  check(
    "sum must be 100",
    validateSchedule(
      [{ id: "a", name: "a", percentage: 50, sortOrder: 0 }],
      views
    ).some((e) => e.includes("sum to 100"))
  );

  check(
    "cannot remove paid milestone",
    validateSchedule(
      [{ id: "b", name: "b", percentage: 100, sortOrder: 0 }],
      views
    ).some((e) => e.includes("cannot be removed"))
  );

  check(
    "cannot shrink below paid amount",
    validateSchedule(
      [
        { id: "a", name: "a", percentage: 5, sortOrder: 0 },
        { id: "b", name: "b", percentage: 95, sortOrder: 1 },
      ],
      views
    ).some((e) => e.includes("below the amount already paid"))
  );

  check(
    "valid edit passes",
    validateSchedule(
      [
        { id: "a", name: "Deposit", percentage: 20, sortOrder: 0 },
        { id: "b", name: "Rest", percentage: 80, sortOrder: 1 },
      ],
      views
    ).length === 0
  );
}

// regression: total reconstruction must not drift on awkward totals.
// total 1000.04 split 10/45/45 -> amounts [100, 450.02, 450.02]; fully pay
// the non-anchor milestone "b" its exact derived amount, then submit a
// true no-op (same 10/45/45 percentages) and expect no errors. Back-solving
// the total from milestone "a" (100 * 100 / 10 = 1000.00, not 1000.04)
// would wrongly report "b" as shrinking below what's already paid.
{
  const ms = [mk("a", 10, 0), mk("b", 45, 1), mk("c", 45, 2)];
  const views = deriveMilestoneViews(ms, [pay("b", 450.02)], 1000.04);

  check(
    "no-op edit on awkward total reports no errors",
    validateSchedule(
      [
        { id: "a", name: "a", percentage: 10, sortOrder: 0 },
        { id: "b", name: "b", percentage: 45, sortOrder: 1 },
        { id: "c", name: "c", percentage: 45, sortOrder: 2 },
      ],
      views
    ).length === 0
  );
}

check("default schedule sums to 100",
  DEFAULT_SCHEDULE.reduce((s, m) => s + m.percentage, 0) === 100);

if (failures) {
  console.error(`${failures} failure(s)`);
  process.exit(1);
}
console.log("ALL PASS");
