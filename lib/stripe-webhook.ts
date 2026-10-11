import type Stripe from "stripe";
import { getUserByStripeCustomerId, linkStripeCustomer } from "@/lib/db/users";
import { syncBillingCustomer } from "@/lib/billing-state";
import { sendCancellationConfirmation } from "@/lib/billing/cancellation-email";

/** Signed events trigger live customer reconciliation. Database revisions serialize
 * writes across workers; event IDs suppress duplicate cancellation notifications. */
export async function processStripeEvent(event: Stripe.Event): Promise<void> {
  if (!["checkout.session.completed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) return;
  const object = event.data.object as Stripe.Subscription | Stripe.Checkout.Session;
  const customerId = typeof object.customer === "string" ? object.customer : object.customer?.id;
  if (!customerId) throw new Error("Missing billing customer");
  if (event.type === "checkout.session.completed") {
    const session = object as Stripe.Checkout.Session;
    if (!session.subscription) return;
    if (session.metadata?.userId) await linkStripeCustomer(session.metadata.userId, customerId);
  }
  const user = await getUserByStripeCustomerId(customerId);
  if (!user) throw new Error("Billing user unavailable");
  const { applied, state } = await syncBillingCustomer(user.id, customerId, event.id);
  if (!applied) return;
  const sub = object as Stripe.Subscription;
  const previous = event.data.previous_attributes as Partial<Stripe.Subscription> | undefined;
  if ((event.type === "customer.subscription.updated" && previous?.cancel_at_period_end === false && state.cancelAtPeriodEnd) ||
      (event.type === "customer.subscription.deleted" && sub.cancel_at_period_end !== true && state.tier === "free")) {
    await sendCancellationConfirmation(user, state.currentPeriodEnd ? Date.parse(state.currentPeriodEnd) / 1000 : null);
  }
}
