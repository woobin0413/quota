import { describe, expect, it } from "vitest";
import { deriveMilestoneViews, validateSchedule } from "@/lib/payment-schedule";
import type { PaymentMilestone } from "@/types/database";

const existing: PaymentMilestone[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    quote_id: "q1",
    user_id: "u1",
    name: "Deposit",
    percentage: 100,
    sort_order: 0,
  },
];

describe("validateSchedule", () => {
  it("rejects a supplied milestone id that is not part of the current quote", () => {
    const current = deriveMilestoneViews(existing, [], 100);

    const errors = validateSchedule(
      [
        {
          id: "22222222-2222-4222-8222-222222222222",
          name: "Foreign milestone",
          percentage: 100,
          sortOrder: 0,
        },
      ],
      current
    );

    expect(errors).toContain(
      "Schedule contains a milestone that does not belong to this quote"
    );
  });
});
