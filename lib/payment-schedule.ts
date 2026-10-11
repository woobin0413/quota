/**
 * Payment Schedule
 *
 * Pure logic for milestone schedules: default split, derived amounts
 * (percent of quote total, last milestone absorbs rounding), per-milestone
 * status from recorded payments, and schedule-edit guards.
 */

import type { PaymentMilestone, QuotePayment } from "@/types/database";

export interface MilestoneInput {
  id?: string; // present = update existing row; absent = create
  name: string;
  percentage: number;
  sortOrder: number;
}

export interface MilestoneView {
  id: string;
  name: string;
  percentage: number;
  sortOrder: number;
  amount: number; // derived share of the quote total
  paidAmount: number; // sum of payments against this milestone
  status: "unpaid" | "partial" | "paid";
}

/** Standard trades split: deposit, pre-construction, during, completion. */
export const DEFAULT_SCHEDULE: { name: string; percentage: number }[] = [
  { name: "Deposit", percentage: 10 },
  { name: "Before construction starts", percentage: 30 },
  { name: "During the work", percentage: 30 },
  { name: "On completion", percentage: 30 },
];

const toCents = (n: number) => Math.round(n * 100);

/**
 * Split `total` by `percentages`. Each amount rounds to cents; the last
 * milestone absorbs the rounding remainder so amounts sum exactly to total.
 */
export function computeMilestoneAmounts(
  total: number,
  percentages: number[]
): number[] {
  if (percentages.length === 0) return [];
  const totalCents = toCents(total);
  const cents = percentages.map((pct) => Math.round((totalCents * pct) / 100));
  const allocated = cents.slice(0, -1).reduce((sum, c) => sum + c, 0);
  cents[cents.length - 1] = totalCents - allocated;
  return cents.map((c) => c / 100);
}

/**
 * Join milestones with their payments and the quote total into view rows
 * (ordered by sort_order). ±1¢ tolerance when deciding "paid".
 */
export function deriveMilestoneViews(
  milestones: PaymentMilestone[],
  payments: QuotePayment[],
  total: number
): MilestoneView[] {
  const ordered = [...milestones].sort((a, b) => a.sort_order - b.sort_order);
  const amounts = computeMilestoneAmounts(
    total,
    ordered.map((m) => m.percentage)
  );

  return ordered.map((m, i) => {
    const paidAmount = payments
      .filter((p) => p.milestone_id === m.id)
      .reduce((sum, p) => sum + p.amount, 0);
    const amount = amounts[i];
    const status: MilestoneView["status"] =
      toCents(paidAmount) <= 0
        ? "unpaid"
        : toCents(paidAmount) >= toCents(amount) - 1
          ? "paid"
          : "partial";
    return {
      id: m.id,
      name: m.name,
      percentage: m.percentage,
      sortOrder: m.sort_order,
      amount,
      paidAmount,
      status,
    };
  });
}

/**
 * Guards for replacing a schedule. `current` is the existing derived view
 * (payments included). Returns human-readable errors; empty = valid.
 */
export function validateSchedule(
  input: MilestoneInput[],
  current: MilestoneView[]
): string[] {
  const errors: string[] = [];

  if (input.length === 0) {
    errors.push("Schedule needs at least one milestone");
    return errors;
  }

  input.forEach((m, i) => {
    if (!m.name.trim()) errors.push(`Milestone ${i + 1} needs a name`);
    if (!(m.percentage > 0 && m.percentage <= 100)) {
      errors.push(`Milestone ${i + 1}: percentage must be between 0 and 100`);
    }
  });

  const sum = input.reduce((s, m) => s + m.percentage, 0);
  if (Math.abs(sum - 100) > 0.001) {
    errors.push(`Percentages must sum to 100 (currently ${sum})`);
  }

  const currentById = new Map(current.map((m) => [m.id, m]));
  const keptIds = new Set(input.filter((m) => m.id).map((m) => m.id as string));

  if (input.some((m) => m.id && !currentById.has(m.id))) {
    errors.push(
      "Schedule contains a milestone that does not belong to this quote"
    );
  }

  // A milestone with payments cannot be deleted
  for (const m of current) {
    if (m.paidAmount > 0 && !keptIds.has(m.id)) {
      errors.push(`"${m.name}" has recorded payments and cannot be removed`);
    }
  }

  // Total the quote total splits over: sum the current milestone amounts.
  // This is exact — computeMilestoneAmounts guarantees the derived amounts
  // sum to the true total (the last milestone absorbs rounding), unlike
  // back-solving from a single milestone's rounded amount, which drifts by
  // cents whenever that milestone isn't the rounding-remainder one. Sums to
  // 0 when `current` is empty, which is harmless: the per-input loop below
  // is gated on `currentById.get(m.id)`, so it no-ops with no current rows.
  const total = current.reduce((sum, m) => sum + m.amount, 0);
  const newAmounts = computeMilestoneAmounts(
    total,
    input.map((m) => m.percentage)
  );

  // A kept milestone's new amount may not drop below what's already paid
  input.forEach((m, i) => {
    if (!m.id) return;
    const existing = currentById.get(m.id);
    if (existing && toCents(newAmounts[i]) < toCents(existing.paidAmount) - 1) {
      errors.push(
        `"${m.name}": new amount is below the amount already paid against it`
      );
    }
  });

  return errors;
}
