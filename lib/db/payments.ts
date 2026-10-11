/**
 * Payments Repository
 *
 * Milestone schedules and recorded payments. quotes.amount_paid/is_paid
 * are maintained by DB trigger — never written here.
 *
 * @module lib/db/payments
 */

import { supabaseAdmin } from "./core";
import type { MilestoneInput } from "@/lib/payment-schedule";
import { NotFoundError } from "@/types/database";
import type {
  PaymentMilestone,
  PaymentMilestoneRow,
  PaymentMethod,
  QuotePayment,
  QuotePaymentRow,
} from "@/types/database";

function transformMilestone(row: PaymentMilestoneRow): PaymentMilestone {
  return {
    id: row.id,
    quote_id: row.quote_id,
    user_id: row.user_id,
    name: row.name,
    percentage: parseFloat(row.percentage?.toString() || "0"),
    sort_order: row.sort_order,
  };
}

function transformPayment(row: QuotePaymentRow): QuotePayment {
  return {
    ...row,
    amount: parseFloat(row.amount?.toString() || "0"),
  };
}

export async function getMilestones(
  quoteId: string,
  userId: string
): Promise<PaymentMilestone[]> {
  const { data, error } = await supabaseAdmin
    .from("payment_milestones")
    .select("*")
    .eq("quote_id", quoteId)
    .eq("user_id", userId)
    .order("sort_order", { ascending: true });

  if (error) throw error;
  return (data as PaymentMilestoneRow[]).map(transformMilestone);
}

/**
 * Lazy backfill: quotes created before split payments get the default
 * 10/30/30/30 schedule on first read. Idempotent.
 */
export async function ensureDefaultSchedule(
  quoteId: string,
  userId: string
): Promise<PaymentMilestone[]> {
  const { data, error } = await supabaseAdmin.rpc(
    "ensure_default_payment_schedule",
    { p_quote_id: quoteId, p_user_id: userId }
  );

  if (error) throw error;
  return ((data ?? []) as PaymentMilestoneRow[]).map(transformMilestone);
}

/**
 * Replace the complete schedule in one database transaction. The caller
 * provides user-facing validation; the RPC repeats ownership and structural
 * checks at the write boundary before changing any row.
 */
export async function replaceSchedule(
  quoteId: string,
  userId: string,
  input: MilestoneInput[]
): Promise<PaymentMilestone[]> {
  const { data, error } = await supabaseAdmin.rpc(
    "replace_payment_schedule_atomic",
    {
      p_quote_id: quoteId,
      p_user_id: userId,
      p_milestones: input.map((milestone) => ({
        id: milestone.id ?? null,
        name: milestone.name,
        percentage: milestone.percentage,
        sortOrder: milestone.sortOrder,
      })),
    }
  );

  if (error) throw error;
  return ((data ?? []) as PaymentMilestoneRow[]).map(transformMilestone);
}

export async function getPayments(
  quoteId: string,
  userId: string
): Promise<QuotePayment[]> {
  const { data, error } = await supabaseAdmin
    .from("quote_payments")
    .select("*")
    .eq("quote_id", quoteId)
    .eq("user_id", userId)
    .order("paid_at", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data as QuotePaymentRow[]).map(transformPayment);
}

export async function recordPayment(
  quoteId: string,
  userId: string,
  input: {
    milestoneId: string;
    amount: number;
    paidAt?: string;
    method?: PaymentMethod;
    note?: string;
  }
): Promise<QuotePayment> {
  // Milestone must belong to this quote and user
  const { data: milestone } = await supabaseAdmin
    .from("payment_milestones")
    .select("id")
    .eq("id", input.milestoneId)
    .eq("quote_id", quoteId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!milestone) {
    throw new NotFoundError(
      "Milestone not found",
      "PaymentMilestone",
      input.milestoneId
    );
  }

  const { data, error } = await supabaseAdmin
    .from("quote_payments")
    .insert({
      quote_id: quoteId,
      milestone_id: input.milestoneId,
      user_id: userId,
      amount: input.amount,
      paid_at: input.paidAt ?? new Date().toISOString().slice(0, 10),
      method: input.method ?? null,
      note: input.note ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return transformPayment(data as QuotePaymentRow);
}

export async function deletePayment(
  quoteId: string,
  userId: string,
  paymentId: string
): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("quote_payments")
    .delete()
    .eq("id", paymentId)
    .eq("quote_id", quoteId)
    .eq("user_id", userId)
    .select("id");

  if (error) throw error;
  if (!data || data.length === 0) {
    throw new NotFoundError("Payment not found", "QuotePayment", paymentId);
  }
}

export async function markPaymentReceiptSent(
  paymentId: string,
  userId: string
): Promise<void> {
  const { data: current, error: fetchError } = await supabaseAdmin
    .from("quote_payments")
    .select("receipt_sent_count")
    .eq("id", paymentId)
    .eq("user_id", userId)
    .single();

  if (fetchError) throw fetchError;

  const { error } = await supabaseAdmin
    .from("quote_payments")
    .update({
      receipt_sent_at: new Date().toISOString(),
      receipt_sent_count: (current?.receipt_sent_count ?? 0) + 1,
    })
    .eq("id", paymentId)
    .eq("user_id", userId);

  if (error) throw error;
}
