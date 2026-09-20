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
          Authorization:
            `Bearer ${secretKey}`,
        },
        cache: "no-store",
      }
    );

    const result =
      await response
        .json()
        .catch(() => null);

    if (
      !response.ok ||
      !result?.status ||
      !Array.isArray(
        result?.data
      )
    ) {
      throw new Error(
        result?.message ||
          "Could not retrieve successful Paystack transactions."
      );
    }

    const pageTransactions =
      result.data as PaystackTransaction[];

    transactions.push(
      ...pageTransactions
    );

    if (
      pageTransactions.length < 100
    ) {
      break;
    }

    page++;
  }

  return transactions;
}

async function fetchAllSupabasePayments(
  db: ReturnType<typeof supabaseAdmin>
): Promise<PaymentRow[]> {
  const rows: PaymentRow[] = [];

  let from = 0;

  while (true) {
    const to = from + 999;

    const { data, error } =
      await db
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

    rows.push(
      ...((data || []) as PaymentRow[])
    );

    if (
      !data ||
      data.length < 1000
    ) {
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
    transactionMetadata(
      transaction
    );

  const metadataValue =
    metadata.vote_count ??
    metadata.voteCount ??
    metadata.votes ??
    metadata.quantity;

  const metadataCount =
    Number(metadataValue);

  if (
    Number.isInteger(
      metadataCount
    ) &&
    metadataCount > 0
  ) {
    return metadataCount;
  }

  const amountKobo =
    paidAmountKobo(
      transaction
    );

  if (
    amountKobo > 0 &&
    amountKobo %
        VOTE_PRICE_KOBO ===
      0
  ) {
    return (
      amountKobo /
      VOTE_PRICE_KOBO
    );
  }

  return null;
}

/*
 * Re-check a transaction directly with Paystack
 * before changing anything in Supabase.
 */
async function verifySuccessfulTransaction(
  transaction: PaystackTransaction
) {
  const verified =
    await verifyPaystackTransaction(
      transaction.reference
    );

  if (
    String(
      verified.status
    ).toLowerCase() !==
    "success"
  ) {
    return null;
  }

  return verified;
}

/*
 * Repair one Paystack-successful transaction.
 */
async function repairSuccessfulTransaction(
  db: ReturnType<typeof supabaseAdmin>,
  transaction: PaystackTransaction
) {
  /*
   * Always verify directly with Paystack.
   */
  const verified =
    await verifySuccessfulTransaction(
      transaction
    );

  if (!verified) {
    return {
      action: "skipped",
      reference:
        transaction.reference,
      reason:
        "Paystack no longer reports this transaction as successful.",
    };
  }

  const metadata =
    transactionMetadata(
      verified
    );

  const expectedVotes =
    getExpectedVoteCount(
      verified
    );

  /*
   * Look for the existing Supabase
   * payment.
   */
  const {
    data: existingPayment,
    error,
  } = await db
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
    .eq(
      "reference",
      verified.reference
    )
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
        db,
        verified
      );

    if (
      result.outcome !==
      "recorded"
    ) {
      return {
        action:
          result.outcome,

        reference:
          verified.reference,

        reason:
          result.message,
      };
    }

    return {
      action: "created",

      reference:
        verified.reference,

      votesAdded:
        result.votesAdded,

      voteCount:
        result.voteCount,
    };
  }

  /*
   * =========================================
   * EXISTING PAYMENT
   * =========================================
   */

  const paystackAmountKobo =
    paidAmountKobo(
      verified
    );

  const currentAmountKobo =
    Number(
      existingPayment.amount_kobo ||
        0
    );

  const currentVoteCount =
    Number(
      existingPayment.vote_count ||
        0
    );

  const updates: Record<
    string,
    any
  > = {};

  /*
   * Paystack requested amount is
   * authoritative for the site.
   */
  if (
    Number.isFinite(
      paystackAmountKobo
    ) &&
    paystackAmountKobo > 0 &&
    currentAmountKobo !==
      paystackAmountKobo
  ) {
    updates.amount_kobo =
      paystackAmountKobo;
  }

  /*
   * Correct stored vote count when
   * Paystack tells us the quantity.
   */
  if (
    expectedVotes &&
    currentVoteCount !==
      expectedVotes
  ) {
    updates.vote_count =
      expectedVotes;
  }

  /*
   * A successful Paystack payment
   * must be successful in Supabase.
   */
  if (
    String(
      existingPayment.status ||
        ""
    ).toLowerCase() !==
    "success"
  ) {
    updates.status =
      "success";
  }

  /*
   * Preserve Paystack payment time.
   */
  if (
    verified.paid_at ||
    verified.transaction_date
  ) {
    updates.paid_at =
      verified.paid_at ||
      verified.transaction_date;
  }

  /*
   * Apply payment corrections.
   */
  if (
    Object.keys(updates).length >
    0
  ) {
    const {
      error: updateError,
    } = await db
      .from("payments")
      .update(updates)
      .eq(
        "id",
        existingPayment.id
      );

    if (updateError) {
      throw new Error(
        `Could not repair payment ${verified.reference}: ${updateError.message}`
      );
    }
  }

  /*
   * =========================================
   * RECOVER MISSING VOTES
   * =========================================
   *
   * recordPaidTransaction() is designed
   * to be idempotent.
   */
  const result =
    await recordPaidTransaction(
      db,
      verified
    );

  if (
    result.outcome !==
    "recorded"
  ) {
    return {
      action:
        result.outcome,

      reference:
        verified.reference,

      reason:
        result.message,
    };
  }

  return {
    action:
      result.votesAdded > 0 ||
      Object.keys(updates).length >
        0
        ? "repaired"
        : "already_correct",

    reference:
      verified.reference,

    votesAdded:
      result.votesAdded,

    voteCount:
      result.voteCount,

    paymentUpdated:
      Object.keys(updates).length >
      0,
  };
}

export async function POST(
  request: NextRequest
) {
  try {
    const db =
      supabaseAdmin();

    /*
     * The request body is deliberately
     * ignored for deciding which records
     * are legitimate.
     */
    await request
      .json()
      .catch(() => ({}));

    /*
     * =========================================
     * STEP 1
     * GET SUCCESSFUL PAYSTACK TRANSACTIONS
     * =========================================
     */

    const successfulPaystack =
      await fetchSuccessfulPaystackTransactions();

    /*
     * =========================================
     * STEP 2
     * VERIFY EVERY SUCCESSFUL TRANSACTION
     * =========================================
     *
     * Only references that successfully
     * pass the second Paystack verification
     * are protected from orphan deletion.
     */

    const verifiedSuccessfulTransactions: PaystackTransaction[] =
      [];

    let verificationSkipped = 0;

    const details: any[] = [];

    for (
      const transaction of
        successfulPaystack
    ) {
      try {
        const verified =
          await verifySuccessfulTransaction(
            transaction
          );

        if (!verified) {
          verificationSkipped++;

          details.push({
            action:
              "verification_skipped",

            reference:
              transaction.reference,

            reason:
              "Transaction was listed as successful but direct Paystack verification did not return success.",
          });

          continue;
        }

        verifiedSuccessfulTransactions.push(
          verified
        );
      } catch (error: any) {
        verificationSkipped++;

        details.push({
          action:
            "verification_failed",

          reference:
            transaction.reference,

          reason:
            error?.message ||
            "Could not re-verify transaction with Paystack.",
        });
      }
    }

    /*
     * These are the ONLY references we will
     * consider legitimate Paystack payments.
     */
    const verifiedSuccessfulReferences =
      new Set(
        verifiedSuccessfulTransactions.map(
          (transaction) =>
            transaction.reference
        )
      );

    /*
     * =========================================
     * STEP 3
     * REPAIR SUCCESSFUL PAYSTACK PAYMENTS
     * =========================================
     */

    let created = 0;

    let repaired = 0;

    let votesAdded = 0;

    let alreadyCorrect = 0;

    let skipped = 0;

    let failed = 0;

    for (
      const transaction of
        verifiedSuccessfulTransactions
    ) {
      try {
        const result =
          await repairSuccessfulTransaction(
            db,
            transaction
          );

        details.push(result);

        if (
          result.action ===
          "created"
        ) {
          created++;
        } else if (
          result.action ===
          "repaired"
        ) {
          repaired++;
        } else if (
          result.action ===
          "already_correct"
        ) {
          alreadyCorrect++;
        } else {
          skipped++;
        }

        if (
          "votesAdded" in result &&
          typeof result.votesAdded ===
            "number"
        ) {
          votesAdded +=
            result.votesAdded;
        }
      } catch (error: any) {
        failed++;

        details.push({
          action:
            "repair_failed",

          reference:
            transaction.reference,

          reason:
            error?.message ||
            "Could not repair transaction.",
        });
      }
    }

    /*
     * =========================================
     * STEP 4
     * LOAD ALL CURRENT SUPABASE PAYMENTS
     * =========================================
     */

    const supabasePayments =
      await fetchAllSupabasePayments(
        db
      );

    /*
     * =========================================
     * STEP 5
     * DELETE SUPABASE-ONLY PAYMENTS
     * =========================================
     */

    let orphanPaymentsDeleted = 0;

    let orphanVotesDeleted = 0;

    let orphanDeleteFailures = 0;

    for (
      const payment of
        supabasePayments
    ) {
      /*
       * A payment with a successfully
       * verified Paystack reference is
       * NEVER considered an orphan.
       */
      if (
        verifiedSuccessfulReferences.has(
          payment.reference
        )
      ) {
        continue;
      }

      try {
        /*
         * delete_orphan_payment must
         * delete:
         *
         * 1. associated votes
         * 2. payment record
         *
         * inside the database function.
         */
        const {
          data,
          error,
        } = await db.rpc(
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
          typeof data ===
          "string"
            ? JSON.parse(data)
            : data;

        const paymentsDeleted =
          Number(
            result?.payments_deleted ||
              0
          );

        const votesDeleted =
          Number(
            result?.votes_deleted ||
              0
          );

        /*
         * SAFETY CHECK:
         *
         * We expected this particular
         * payment to be deleted.
         *
         * If the database function reports
         * zero deleted payments, treat that
         * as a failure instead of claiming
         * the deletion succeeded.
         */
        if (
          paymentsDeleted < 1
        ) {
          throw new Error(
            "delete_orphan_payment completed but did not delete the expected payment record."
          );
        }

        orphanPaymentsDeleted +=
          paymentsDeleted;

        orphanVotesDeleted +=
          votesDeleted;

        details.push({
          action:
            "orphan_deleted",

          reference:
            payment.reference,

          paymentDeleted:
            paymentsDeleted,

          votesDeleted,
        });
      } catch (error: any) {
        failed++;

        orphanDeleteFailures++;

        details.push({
          action:
            "orphan_delete_failed",

          reference:
            payment.reference,

          reason:
            error?.message ||
            "Could not delete orphan payment.",
        });
      }
    }

    /*
     * =========================================
     * FINAL RESULT
     * =========================================
     */

    return NextResponse.json({
      success:
        failed === 0,

      summary: {
        paystackTransactions:
          verifiedSuccessfulTransactions.length,

        initiallyListedPaystackTransactions:
          successfulPaystack.length,

        verificationSkipped,

        created,

        repaired,

        votesAdded,

        alreadyCorrect,

        skipped,

        orphanPaymentsDeleted,

        orphanVotesDeleted,

        orphanDeleteFailures,

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
      {
        status: 500,
      }
    );
  }
}
