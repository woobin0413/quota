import { getBillingRelevantUsers } from "@/lib/db/users";
import { syncBillingCustomer } from "@/lib/billing-state";
import { logger } from "@/lib/logger";
export interface ReconcileReport { checked: number; drifted: { userId: string; from: string; to: string }[]; errors: number; }
/** Every observation advances the revision, including unchanged entitlements,
 * so an in-flight older snapshot cannot overwrite the verified current state. */
export async function reconcileBilling(): Promise<ReconcileReport> {
  const report: ReconcileReport = { checked: 0, drifted: [], errors: 0 };
  for (const user of await getBillingRelevantUsers()) {
    report.checked++;
    try {
      const { applied, state } = await syncBillingCustomer(user.id, user.stripe_customer_id);
      if (applied && user.subscription_tier !== state.tier) report.drifted.push({ userId: user.id, from: user.subscription_tier, to: state.tier });
    } catch (error) {
      logger.error("Reconcile: user failed", { err: error, userId: user.id }); report.errors++;
    }
  }
  return report;
}
