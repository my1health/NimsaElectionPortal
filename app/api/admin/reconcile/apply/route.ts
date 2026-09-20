import { NextRequest, NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabaseAdmin";

import {
  paidAmountKobo,
  transactionMetadata,
  recordPaidTransaction,
  verifyPaystackTransaction,
  PaystackTransaction,
} from "@/lib/paystack";

const VOTE_PRICE_KOBO = 100 * 100;

type PaymentRow = {
  id: string;
  reference: string;
  email?: string | null;
  nominee_id?: string | null;
  amount_kobo?: number | null;
  vote_count?: number | null;
  status?: string | null;
};

async function fetchSuccessfulPaystackTransactions(): Promise<
  PaystackTransaction[]
> {
  const secretKey =
    process.env.PAYSTACK_SECRET_KEY;

  if (!secretKey) {
    throw new Error(
      "PAYSTACK_SECRET_KEY is not configured."
    );
  }

  const transactions: PaystackTransaction[] =
    [];

  let page = 1;

  while (page <= 100) {
    const response = await fetch(
      `https://api.paystack.co/transaction?status=success&perPage=100&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${secretKey}`,
        },
        cache: "no-store",
      }
    );

    const result = await response
      .json()
      .catch(() => null);

    if (
      !response.ok ||
      !result?.status ||
      !Array.isArray(result?.data)
    ) {
      throw new Error(
        result?.message ||
          "Could not retrieve successful Paystack transactions."
      );
    }

    const pageTransactions =
      result.data as PaystackTransaction[];

    transactions.push(...pageTransactions);

    if (pageTransactions.length < 100) {
      break;
    }

    page++;
  }

  return transactions;
}

async function fetchAllSupabasePayments(): Promise<
  PaymentRow[]
> {
  const rows: PaymentRow[] = [];

  let from = 0;

  while (true) {
    const to = from + 999;

    const { data, error } =
      await supabaseAdmin
        .from("payments")
        .select(
          `
          id,
          reference,
          email,
          nominee_id,
          amount_kobo,
          vote_count,
          status
          `
        )
        .range(from, to);

    if (error) {
      throw new Error(
        `Could not load Supabase payments: ${error.message}`
      );
    }

    rows.push(...((data || []) as PaymentRow[]));

    if (!data || data.length < 1000) {
      break;
    }

    from += 1000;
  }

  return rows;
}

function getExpectedVoteCount(
  transaction: PaystackTransaction
) {
  const metadata =
    transactionMetadata(transaction);

  const metadataValue =
    metadata.vote_count ??
    metadata.voteCount ??
    metadata.votes ??
    metadata.quantity;

  const metadataCount =
    Number(metadataValue);

  if (
    Number.isInteger(metadataCount) &&
    metadataCount > 0
  ) {
    return metadataCount;
  }

  const amountKobo =
    paidAmountKobo(transaction);

  if (
    amountKobo > 0 &&
    amountKobo % VOTE_PRICE_KOBO === 0
  ) {
    return amountKobo / VOTE_PRICE_KOBO;
  }

  return null;
}

async function repairSuccessfulTransaction(
  transaction: PaystackTransaction
) {
  /*
   * Verify this transaction directly with Paystack again.
   * We do not trust the transaction reference supplied
   * by the browser.
   */
  const verified =
    await verifyPaystackTransaction(
      transaction.reference
    );

  if (
    String(verified.status).toLowerCase() !==
    "success"
  ) {
    return {
      action: "skipped",
      reference: transaction.reference,
      reason:
        "Paystack no longer reports this transaction as successful.",
    };
  }

  const metadata =
    transactionMetadata(verified);

  const expectedVotes =
    getExpectedVoteCount(verified);

  const nomineeId =
    metadata.nominee_id ||
    metadata.nomineeId;

  /*
   * If this payment does not exist, recordPaidTransaction()
   * can rebuild it from Paystack metadata.
   */
  const { data: existingPayment, error } =
    await supabaseAdmin
      .from("payments")
      .select(
        `
        id,
        reference,
        email,
        nominee_id,
        amount_kobo,
        vote_count,
        status
        `
      )
      .eq("reference", verified.reference)
      .maybeSingle();

  if (error) {
    throw new Error(
      `Could not load ${verified.reference}: ${error.message}`
    );
  }

  /*
   * =========================================
   * MISSING PAYMENT
   * =========================================
   */

  if (!existingPayment) {
    const result =
      await recordPaidTransaction(
        supabaseAdmin,
        verified
      );

    if (result.outcome !== "recorded") {
      return {
        action: result.outcome,
        reference: verified.reference,
        reason: result.message,
      };
    }

    return {
      action: "created",
      reference: verified.reference,
      votesAdded: result.votesAdded,
      voteCount: result.voteCount,
    };
  }

  /*
   * =========================================
   * CORRECT THE PAYMENT AMOUNT / VOTE COUNT
   * =========================================
   *
   * Paystack is authoritative here.
   */

  const paystackAmountKobo =
    paidAmountKobo(verified);

  const currentAmountKobo =
    Number(existingPayment.amount_kobo || 0);

  const currentVoteCount =
    Number(existingPayment.vote_count || 0);

  const updates: Record<string, any> = {};

  if (
    Number.isFinite(paystackAmountKobo) &&
    paystackAmountKobo > 0 &&
    currentAmountKobo !== paystackAmountKobo
  ) {
    updates.amount_kobo =
      paystackAmountKobo;
  }

  if (
    expectedVotes &&
    currentVoteCount !== expectedVotes
  ) {
    updates.vote_count =
      expectedVotes;
  }

  /*
   * A successful Paystack transaction must be marked
   * successful in Supabase.
   */
  if (
    String(existingPayment.status).toLowerCase() !==
    "success"
  ) {
    updates.status = "success";
  }

  if (
    verified.paid_at ||
    verified.transaction_date
  ) {
    updates.paid_at =
      verified.paid_at ||
      verified.transaction_date;
  }

  if (Object.keys(updates).length > 0) {
    const { error: updateError } =
      await supabaseAdmin
        .from("payments")
        .update(updates)
        .eq("id", existingPayment.id);

    if (updateError) {
      throw new Error(
        `Could not repair payment ${verified.reference}: ${updateError.message}`
      );
    }
  }

  /*
   * =========================================
   * RECORD / RECOVER MISSING VOTES
   * =========================================
   *
   * record_payment_votes is idempotent, so calling it
   * here is safe even if the votes already exist.
   */

  const result =
    await recordPaidTransaction(
      supabaseAdmin,
      verified
    );

  if (result.outcome !== "recorded") {
    return {
      action: result.outcome,
      reference: verified.reference,
      reason: result.message,
    };
  }

  return {
    action:
      result.votesAdded > 0 ||
      Object.keys(updates).length > 0
        ? "repaired"
        : "already_correct",
    reference: verified.reference,
    votesAdded: result.votesAdded,
    voteCount: result.voteCount,
    paymentUpdated:
      Object.keys(updates).length > 0,
  };
}

export async function POST(
  request: NextRequest
) {
  try {
    /*
     * The body is intentionally NOT trusted to decide
     * what gets deleted.
     *
     * The server performs a fresh full reconciliation.
     */
    await request.json().catch(() => ({}));

    /*
     * =========================================
     * STEP 1:
     * GET ALL SUCCESSFUL PAYSTACK PAYMENTS
     * =========================================
     */

    const successfulPaystack =
      await fetchSuccessfulPaystackTransactions();

    const successfulReferences =
      new Set(
        successfulPaystack.map(
          (transaction) =>
            transaction.reference
        )
      );

    /*
     * =========================================
     * STEP 2:
     * REPAIR EVERY SUCCESSFUL PAYSTACK PAYMENT
     * =========================================
     */

    let created = 0;
    let repaired = 0;
    let votesAdded = 0;
    let alreadyCorrect = 0;
    let skipped = 0;
    let failed = 0;

    const details: any[] = [];

    for (const transaction of successfulPaystack) {
      try {
        const result =
          await repairSuccessfulTransaction(
            transaction
          );

        details.push(result);

        if (result.action === "created") {
          created++;
        } else if (
          result.action === "repaired"
        ) {
          repaired++;
        } else if (
          result.action === "already_correct"
        ) {
          alreadyCorrect++;
        } else {
          skipped++;
        }

        if (
          "votesAdded" in result &&
          typeof result.votesAdded === "number"
        ) {
          votesAdded += result.votesAdded;
        }
      } catch (error: any) {
        failed++;

        details.push({
          action: "failed",
          reference: transaction.reference,
          reason:
            error?.message ||
            "Could not repair transaction.",
        });
      }
    }

    /*
     * =========================================
     * STEP 3:
     * REMOVE SUPABASE PAYMENTS THAT ARE NOT
     * SUCCESSFUL PAYSTACK TRANSACTIONS
     * =========================================
     */

    const supabasePayments =
      await fetchAllSupabasePayments();

    let orphanPaymentsDeleted = 0;
    let orphanVotesDeleted = 0;

    for (const payment of supabasePayments) {
      if (
        successfulReferences.has(
          payment.reference
        )
      ) {
        continue;
      }

      try {
        /*
         * Delete both payment + associated votes
         * atomically through the database function.
         */
        const { data, error } =
          await supabaseAdmin.rpc(
            "delete_orphan_payment",
            {
              p_reference:
                payment.reference,
            }
          );

        if (error) {
          throw new Error(
            error.message
          );
        }

        const result =
          typeof data === "string"
            ? JSON.parse(data)
            : data;

        orphanPaymentsDeleted +=
          Number(
            result?.payments_deleted || 0
          );

        orphanVotesDeleted +=
          Number(
            result?.votes_deleted || 0
          );

        details.push({
          action: "orphan_deleted",
          reference:
            payment.reference,
          votesDeleted: Number(
            result?.votes_deleted || 0
          ),
          paymentDeleted: Number(
            result?.payments_deleted || 0
          ),
        });
      } catch (error: any) {
        failed++;

        details.push({
          action: "orphan_delete_failed",
          reference:
            payment.reference,
          reason:
            error?.message ||
            "Could not delete orphan payment.",
        });
      }
    }

    return NextResponse.json({
      success: failed === 0,

      summary: {
        paystackTransactions:
          successfulPaystack.length,

        created,

        repaired,

        votesAdded,

        alreadyCorrect,

        skipped,

        orphanPaymentsDeleted,

        orphanVotesDeleted,

        failed,
      },

      details,
    });
  } catch (error: any) {
    console.error(
      "RECONCILIATION APPLY ERROR:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error?.message ||
          "Could not apply reconciliation.",
      },
      { status: 500 }
    );
  }
}
