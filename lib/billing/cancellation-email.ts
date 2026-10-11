/**
 * Best-effort cancellation confirmation email, shared by the cancel and
 * downgrade-to-free routes. Never throws — a failed send must not fail the
 * billing action (the cancellation already succeeded in Stripe).
 */
import { sendCancellationEmail } from "@/lib/email-sender";
import { resolveTier, TIER_LABEL } from "@/lib/subscription";
import { formatDate } from "@/lib/utils";
import { logger } from "@/lib/logger";
import type { User } from "@/types/database";

export async function sendCancellationConfirmation(
  user: User,
  currentPeriodEnd: number | null | undefined
): Promise<void> {
  if (!user.email) return;
  try {
    const tier = resolveTier(user.subscription_tier);
    const base =
      process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_BASE_URL ?? "";
    await sendCancellationEmail({
      recipientEmail: user.email,
      data: {
        recipientName: user.company_name || user.first_name || "there",
        planLabel: TIER_LABEL[tier] ?? "your plan",
        accessUntil: currentPeriodEnd
          ? formatDate(new Date(currentPeriodEnd * 1000))
          : undefined,
        billingUrl: base ? `${base}/billing` : undefined,
      },
    });
  } catch (e) {
    logger.error("Cancellation confirmation email failed", {
      err: e,
      userId: user.id,
    });
  }
}
