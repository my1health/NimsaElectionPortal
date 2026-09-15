import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type ReconItem = {
  reference: string;
  issue: string;
  paystackAmountKobo?: number;
  supabaseAmountKobo?: number;
  paystackVoteCount?: number;
  supabaseVoteCount?: number;
  nomineeId?: string | null;
  nomineeName?: string | null;
  categoryId?: string | null;
  email?: string | null;
  message?: string;
};

function getMetadata(transaction: any) {
  const metadata = transaction?.metadata;

  if (!metadata) return {};

  if (typeof metadata === "string") {
    try {
      return JSON.parse(metadata);
    } catch {
      return {};
    }
  }

  return metadata;
}

async function fetchAllPaystackTransactions() {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;

  if (!secretKey) {
    throw new Error("PAYSTACK_SECRET_KEY is missing");
  }

  const allTransactions: any[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const response = await fetch(
      `https://api.paystack.co/transaction?status=success&perPage=${perPage}&page=${page}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/json",
        },
        cache: "no-store",
      }
    );

    const data = await response.json();

    if (!response.ok || !data.status) {
      throw new Error(
        data?.message || "Unable to retrieve Paystack transactions"
      );
    }

    const transactions = data?.data || [];

    allTransactions.push(...transactions);

    if (transactions.length < perPage) {
      break;
    }

    page++;
  }

  return allTransactions;
}

export async function GET() {
  try {
    const [
      paystackTransactions,
      paymentsResult,
      votesResult,
    ] = await Promise.all([
      fetchAllPaystackTransactions(),

      supabase
        .from("payments")
        .select("*")
        .order("created_at", { ascending: true }),

      supabase
        .from("votes")
        .select("*")
        .order("created_at", { ascending: true }),
    ]);

    if (paymentsResult.error) {
      throw new Error(
        `Unable to retrieve Supabase payments: ${paymentsResult.error.message}`
      );
    }

    if (votesResult.error) {
      throw new Error(
        `Unable to retrieve Supabase votes: ${votesResult.error.message}`
      );
    }

    const payments = paymentsResult.data || [];
    const votes = votesResult.data || [];

    const paymentMap = new Map<string, any>();

    for (const payment of payments) {
      if (payment.reference) {
        paymentMap.set(String(payment.reference), payment);
      }

      if (payment.payment_reference) {
        paymentMap.set(String(payment.payment_reference), payment);
      }
    }

    const voteCountMap = new Map<string, number>();

    for (const vote of votes) {
      const reference =
        vote.payment_reference ||
        vote.reference ||
        vote.transaction_reference;

      if (!reference) continue;

      const key = String(reference);

      voteCountMap.set(key, (voteCountMap.get(key) || 0) + 1);
    }

    const items: ReconItem[] = [];

    let ok = 0;
    let missingPayment = 0;
    let missingVotes = 0;
    let amountMismatch = 0;
    let extraVotes = 0;
    let missingMetadata = 0;
    let paymentNotMarkedSuccess = 0;
    let supabaseOnly = 0;

    let totalPaystackAmountKobo = 0;
    let totalSupabaseAmountKobo = 0;

    for (const transaction of paystackTransactions) {
      const reference = String(transaction.reference);
      const paystackAmountKobo = Number(transaction.amount || 0);

      totalPaystackAmountKobo += paystackAmountKobo;

      const metadata = getMetadata(transaction);

      const payment = paymentMap.get(reference);

      const expectedVoteCount = Number(metadata.vote_count || 0);

      const supabaseVoteCount = voteCountMap.get(reference) || 0;

      const nomineeId =
        metadata.nominee_id ||
        payment?.nominee_id ||
        null;

      const nomineeName =
        metadata.nominee_name ||
        payment?.nominee_name ||
        null;

      const categoryId =
        metadata.category_id ||
        payment?.category_id ||
        null;

      const email =
        transaction.customer?.email ||
        payment?.email ||
        null;

      if (!payment) {
        missingPayment++;

        items.push({
          reference,
          issue: "missing_payment",
          paystackAmountKobo,
          supabaseAmountKobo: 0,
          paystackVoteCount: expectedVoteCount || undefined,
          supabaseVoteCount,
          nomineeId,
          nomineeName,
          categoryId,
          email,
          message:
            "Successful Paystack transaction has no matching Supabase payment record.",
        });

        continue;
      }

      const supabaseAmountKobo = Number(
        payment.amount_kobo ??
          payment.amount ??
          0
      );

      totalSupabaseAmountKobo += supabaseAmountKobo;

      if (!nomineeId || !expectedVoteCount) {
        missingMetadata++;

        items.push({
          reference,
          issue: "missing_metadata",
          paystackAmountKobo,
          supabaseAmountKobo,
          paystackVoteCount: expectedVoteCount || undefined,
          supabaseVoteCount,
          nomineeId,
          nomineeName,
          categoryId,
          email,
          message:
            "The Paystack transaction is missing nominee_id or vote_count metadata.",
        });

        continue;
      }

      if (
        payment.status &&
        String(payment.status).toLowerCase() !== "success"
      ) {
        paymentNotMarkedSuccess++;

        items.push({
          reference,
          issue: "payment_not_marked_success",
          paystackAmountKobo,
          supabaseAmountKobo,
          paystackVoteCount: expectedVoteCount,
          supabaseVoteCount,
          nomineeId,
          nomineeName,
          categoryId,
          email,
          message:
            "Paystack says the transaction succeeded, but Supabase payment is not marked successful.",
        });

        continue;
      }

      if (supabaseAmountKobo !== paystackAmountKobo) {
        amountMismatch++;

        items.push({
          reference,
          issue: "amount_mismatch",
          paystackAmountKobo,
          supabaseAmountKobo,
          paystackVoteCount: expectedVoteCount,
          supabaseVoteCount,
          nomineeId,
          nomineeName,
          categoryId,
          email,
          message:
            "The Paystack amount differs from the amount recorded in Supabase.",
        });

        continue;
      }

      if (supabaseVoteCount < expectedVoteCount) {
        missingVotes++;

        items.push({
          reference,
          issue: "missing_votes",
          paystackAmountKobo,
          supabaseAmountKobo,
          paystackVoteCount: expectedVoteCount,
          supabaseVoteCount,
          nomineeId,
          nomineeName,
          categoryId,
          email,
          message:
            `Paystack metadata expects ${expectedVoteCount} vote(s), but Supabase has ${supabaseVoteCount}.`,
        });

        continue;
      }

      if (supabaseVoteCount > expectedVoteCount) {
        extraVotes++;

        items.push({
          reference,
          issue: "extra_votes",
          paystackAmountKobo,
          supabaseAmountKobo,
          paystackVoteCount: expectedVoteCount,
          supabaseVoteCount,
          nomineeId,
          nomineeName,
          categoryId,
          email,
          message:
            `Supabase contains ${supabaseVoteCount} vote(s), while Paystack metadata expects ${expectedVoteCount}.`,
        });

        continue;
      }

      ok++;
    }

    /*
     * Find Supabase payments which do not have a successful Paystack
     * transaction with the same reference.
     */
    const paystackReferences = new Set(
      paystackTransactions.map((transaction) =>
        String(transaction.reference)
      )
    );

    for (const payment of payments) {
      const reference =
        payment.reference ||
        payment.payment_reference;

      if (!reference) continue;

      const ref = String(reference);

      if (!paystackReferences.has(ref)) {
        supabaseOnly++;

        const amountKobo = Number(
          payment.amount_kobo ??
            payment.amount ??
            0
        );

        totalSupabaseAmountKobo += amountKobo;

        items.push({
          reference: ref,
          issue: "supabase_only",
          paystackAmountKobo: 0,
          supabaseAmountKobo: amountKobo,
          supabaseVoteCount: voteCountMap.get(ref) || 0,
          nomineeId: payment.nominee_id || null,
          nomineeName: payment.nominee_name || null,
          categoryId: payment.category_id || null,
          email: payment.email || null,
          message:
            "Supabase has a payment record but no matching successful Paystack transaction was found.",
        });
      }
    }

    /*
     * Recalculate totals more safely from actual records.
     * This excludes the duplicated amount that may have been counted
     * while processing Supabase-only records.
     */
    const actualSupabaseAmountKobo = payments.reduce(
      (total, payment) =>
        total +
        Number(
          payment.amount_kobo ??
            payment.amount ??
            0
        ),
      0
    );

    totalSupabaseAmountKobo = actualSupabaseAmountKobo;

    return NextResponse.json({
      success: true,

      summary: {
        paystackTransactions: paystackTransactions.length,
        supabasePayments: payments.length,

        totalPaystackAmountKobo,

        totalSupabaseAmountKobo,

        ok,
        missingPayment,
        missingVotes,
        amountMismatch,
        extraVotes,
        missingMetadata,
        paymentNotMarkedSuccess,
        supabaseOnly,
      },

      items,
    });
  } catch (error: any) {
    console.error("PAYSTACK RECONCILIATION ERROR:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error?.message ||
          "Paystack reconciliation failed",
      },
      { status: 500 }
    );
  }
}
