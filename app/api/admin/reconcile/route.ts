import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import {
  amountMatches,
  paidAmountKobo,
  transactionMetadata,
  PaystackTransaction,
} from "@/lib/paystack";

const VOTE_PRICE_KOBO = 100 * 100;

function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Supabase server environment variables are missing."
    );
  }

  return createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/*
 * IMPORTANT:
 *
 * This type reflects the ACTUAL payments table.
 *
 * payments does NOT contain category_id.
 */
type PaymentRow = {
  id: string;
  reference: string;
  email?: string | null;
  nominee_id?: string | null;
  amount_kobo?: number | null;
  vote_count?: number | null;
  status?: string | null;
  created_at?: string | null;
  paid_at?: string | null;
};

type VoteRow = {
  id: string;
  payment_reference?: string | null;
};

function metadataValue(
  metadata: Record<string, any>,
  ...keys: string[]
) {
  for (const key of keys) {
    if (
      metadata[key] !== undefined &&
      metadata[key] !== null &&
      metadata[key] !== ""
    ) {
      return metadata[key];
    }
  }

  return undefined;
}

function toNumber(
  value: unknown
): number | null {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

function toStringValue(
  value: unknown
): string | null {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  const valueString =
    String(value).trim();

  return valueString || null;
}

/*
 * =========================================
 * FETCH ALL SUPABASE PAYMENTS
 * =========================================
 */

async function fetchAllPayments(
  db: ReturnType<typeof createAdminClient>
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
          status,
          created_at,
          paid_at
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

/*
 * =========================================
 * FETCH ALL SUPABASE VOTES
 * =========================================
 */

async function fetchAllVotes(
  db: ReturnType<typeof createAdminClient>
): Promise<VoteRow[]> {
  const rows: VoteRow[] = [];

  let from = 0;

  while (true) {
    const to = from + 999;

    const { data, error } =
      await db
        .from("votes")
        .select(
          "id, payment_reference"
        )
        .range(from, to);

    if (error) {
      throw new Error(
        `Could not load Supabase votes: ${error.message}`
      );
    }

    rows.push(
      ...((data || []) as VoteRow[])
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

/*
 * =========================================
 * FETCH SUCCESSFUL PAYSTACK TRANSACTIONS
 * =========================================
 */

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
    const response =
      await fetch(
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

    /*
     * Fewer than 100 means this
     * is the last page.
     */
    if (
      pageTransactions.length < 100
    ) {
      break;
    }

    page++;
  }

  return transactions;
}

/*
 * =========================================
 * DETERMINE EXPECTED VOTES
 * =========================================
 *
 * Priority:
 *
 * 1. Paystack metadata vote count
 * 2. Paystack requested amount / ₦100
 *
 * This prevents Paystack processing fees from
 * being interpreted as additional votes.
 */

function getExpectedVoteCount(
  transaction: PaystackTransaction
): number | null {
  const metadata =
    transactionMetadata(
      transaction
    );

  const metadataValue =
    metadataValueFromTransaction(
      metadata
    );

  const metadataCount =
    toNumber(metadataValue);

  if (
    metadataCount !== null &&
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

function metadataValueFromTransaction(
  metadata: Record<string, any>
) {
  return metadataValue(
    metadata,
    "vote_count",
    "voteCount",
    "votes",
    "quantity"
  );
}

/*
 * =========================================
 * MAIN RECONCILIATION
 * =========================================
 */

export async function GET() {
  try {
    const db =
      createAdminClient();

    /*
     * Fetch Paystack, payments and votes
     * independently.
     */
    const [
      successfulPaystack,
      supabasePayments,
      supabaseVotes,
    ] = await Promise.all([
      fetchSuccessfulPaystackTransactions(),
      fetchAllPayments(db),
      fetchAllVotes(db),
    ]);

    /*
     * =========================================
     * INDEX SUPABASE PAYMENTS
     * =========================================
     */

    const paymentByReference =
      new Map<
        string,
        PaymentRow
      >();

    for (
      const payment of
        supabasePayments
    ) {
      if (!payment.reference) {
        continue;
      }

      paymentByReference.set(
        payment.reference,
        payment
      );
    }

    /*
     * =========================================
     * INDEX VOTES BY PAYMENT REFERENCE
     * =========================================
     */

    const votesByReference =
      new Map<
        string,
        VoteRow[]
      >();

    for (
      const vote of
        supabaseVotes
    ) {
      if (
        !vote.payment_reference
      ) {
        continue;
      }

      const current =
        votesByReference.get(
          vote.payment_reference
        ) || [];

      current.push(vote);

      votesByReference.set(
        vote.payment_reference,
        current
      );
    }

    /*
     * =========================================
     * PAYSTACK SUCCESS REFERENCES
     * =========================================
     */

    const paystackReferences =
      new Set(
        successfulPaystack.map(
          (transaction) =>
            transaction.reference
        )
      );

    /*
     * =========================================
     * SUMMARY VARIABLES
     * =========================================
     */

    const items: any[] = [];

    let totalPaystackAmountKobo = 0;

    let totalSupabaseAmountKobo = 0;

    let missingPayment = 0;

    let missingVotes = 0;

    let amountMismatch = 0;

    let extraVotes = 0;

    let missingMetadata = 0;

    let paymentNotMarkedSuccess = 0;

    let supabaseOnly = 0;

    let matched = 0;

    let paystackSuccessfulVotes = 0;

    let supabaseSuccessfulVotes = 0;

    /*
     * =========================================
     * PROCESS SUCCESSFUL PAYSTACK TRANSACTIONS
     * =========================================
     */

    for (
      const transaction of
        successfulPaystack
    ) {
      const reference =
        transaction.reference;

      /*
       * This is the amount the site
       * actually requested from the voter.
       *
       * If Paystack added processing fees,
       * paidAmountKobo() uses requested_amount
       * when available.
       */
      const paystackAmountKobo =
        paidAmountKobo(
          transaction
        );

      totalPaystackAmountKobo +=
        paystackAmountKobo;

      /*
       * Extract Paystack metadata.
       */
      const metadata =
        transactionMetadata(
          transaction
        );

      const nomineeId =
        toStringValue(
          metadataValue(
            metadata,
            "nominee_id",
            "nomineeId"
          )
        );

      /*
       * Determine expected vote count.
       */
      const expectedVoteCount =
        getExpectedVoteCount(
          transaction
        );

      if (
        expectedVoteCount !==
          null &&
        expectedVoteCount > 0
      ) {
        paystackSuccessfulVotes +=
          expectedVoteCount;
      }

      /*
       * Find corresponding Supabase payment.
       */
      const payment =
        paymentByReference.get(
          reference
        );

      /*
       * =========================================
       * MISSING PAYMENT
       * =========================================
       */

      if (!payment) {
        missingPayment++;

        items.push({
          reference,

          type:
            "missing_payment",

          status:
            "missing",

          paystackAmountKobo,

          expectedVotes:
            expectedVoteCount,

          nomineeId,

          message:
            "Successful Paystack transaction has no Supabase payment record.",
        });

        continue;
      }

      /*
       * =========================================
       * SUPABASE PAYMENT EXISTS
       * =========================================
       */

      const supabaseAmountKobo =
        Number(
          payment.amount_kobo || 0
        );

      const paymentStatus =
        String(
          payment.status || ""
        ).toLowerCase();

      /*
       * Count successful Supabase
       * money only when the payment is
       * actually marked successful.
       */
      if (
        paymentStatus ===
        "success"
      ) {
        totalSupabaseAmountKobo +=
          supabaseAmountKobo;
      }

      /*
       * Count actual vote rows.
       */
      const actualVotes =
        votesByReference.get(
          reference
        )?.length || 0;

      /*
       * =========================================
       * PAYMENT NOT MARKED SUCCESS
       * =========================================
       */

      if (
        paymentStatus !==
        "success"
      ) {
        paymentNotMarkedSuccess++;

        items.push({
          reference,

          type:
            "payment_not_marked_success",

          status:
            "repair",

          paystackAmountKobo,

          supabaseAmountKobo,

          expectedVotes:
            expectedVoteCount,

          actualVotes,

          nomineeId:
            nomineeId ||
            payment.nominee_id ||
            null,

          message:
            "Paystack reports success but the Supabase payment is not marked success.",
        });

        continue;
      }

      /*
       * =========================================
       * AMOUNT CHECK
       * =========================================
       */

      if (
        !amountMatches(
          transaction,
          supabaseAmountKobo
        )
      ) {
        amountMismatch++;

        items.push({
          reference,

          type:
            "amount_mismatch",

          status:
            "repair",

          paystackAmountKobo,

          supabaseAmountKobo,

          expectedVotes:
            expectedVoteCount,

          actualVotes,

          nomineeId:
            nomineeId ||
            payment.nominee_id ||
            null,

          message:
            "Supabase amount does not match the successful Paystack transaction.",
        });

        continue;
      }

      /*
       * =========================================
       * FINAL EXPECTED VOTE COUNT
       * =========================================
       *
       * If Paystack metadata does not contain
       * a vote count, fall back to the existing
       * Supabase payment.vote_count.
       */

      const finalExpectedVotes =
        expectedVoteCount !==
          null &&
        Number.isInteger(
          expectedVoteCount
        ) &&
        expectedVoteCount > 0
          ? expectedVoteCount
          : Number(
              payment.vote_count ||
                0
            );

      const finalNomineeId =
        nomineeId ||
        payment.nominee_id ||
        null;

      /*
       * =========================================
       * MISSING NOMINEE / VOTE INFORMATION
       * =========================================
       */

      if (
        !finalNomineeId ||
        !Number.isInteger(
          finalExpectedVotes
        ) ||
        finalExpectedVotes < 1
      ) {
        missingMetadata++;

        items.push({
          reference,

          type:
            "missing_metadata",

          status:
            "manual_review",

          paystackAmountKobo,

          supabaseAmountKobo,

          expectedVotes:
            finalExpectedVotes,

          actualVotes,

          nomineeId:
            finalNomineeId,

          message:
            "The payment is successful but nominee or vote information cannot be safely determined.",
        });

        continue;
      }

      /*
       * =========================================
       * MISSING VOTES
       * =========================================
       */

      if (
        actualVotes <
        finalExpectedVotes
      ) {
        missingVotes++;

        items.push({
          reference,

          type:
            "missing_votes",

          status:
            "repair",

          paystackAmountKobo,

          supabaseAmountKobo,

          expectedVotes:
            finalExpectedVotes,

          actualVotes,

          missingVoteCount:
            finalExpectedVotes -
            actualVotes,

          nomineeId:
            finalNomineeId,

          message:
            "Some vote rows are missing for this successful Paystack payment.",
        });

        continue;
      }

      /*
       * =========================================
       * EXTRA VOTES
       * =========================================
       *
       * IMPORTANT:
       *
       * We DO NOT automatically delete these.
       *
       * The payment itself is backed by a
       * successful Paystack transaction.
       */

      if (
        actualVotes >
        finalExpectedVotes
      ) {
        extraVotes++;

        items.push({
          reference,

          type:
            "extra_votes",

          status:
            "review",

          paystackAmountKobo,

          supabaseAmountKobo,

          expectedVotes:
            finalExpectedVotes,

          actualVotes,

          extraVoteCount:
            actualVotes -
            finalExpectedVotes,

          nomineeId:
            finalNomineeId,

          message:
            "Supabase contains more vote rows than expected for this valid Paystack payment. No votes were deleted automatically.",
        });

        /*
         * Do not count these as a normal
         * fully matched payment.
         */
        continue;
      }

      /*
       * =========================================
       * FULLY MATCHED TRANSACTION
       * =========================================
       */

      matched++;

      supabaseSuccessfulVotes +=
        actualVotes;

      items.push({
        reference,

        type:
          "ok",

        status:
          "ok",

        paystackAmountKobo,

        supabaseAmountKobo,

        expectedVotes:
          finalExpectedVotes,

        actualVotes,

        nomineeId:
          finalNomineeId,
      });
    }

    /*
     * =========================================
     * SUPABASE-ONLY PAYMENTS
     * =========================================
     *
     * These are payment records that do NOT
     * have a corresponding successful Paystack
     * transaction.
     *
     * The Apply endpoint will remove these
     * payments and their associated votes.
     */

    for (
      const payment of
        supabasePayments
    ) {
      if (
        paystackReferences.has(
          payment.reference
        )
      ) {
        continue;
      }

      supabaseOnly++;

      const associatedVotes =
        votesByReference.get(
          payment.reference
        )?.length || 0;

      items.push({
        reference:
          payment.reference,

        type:
          "supabase_only",

        status:
          "delete",

        supabaseAmountKobo:
          Number(
            payment.amount_kobo ||
              0
          ),

        actualVotes:
          associatedVotes,

        nomineeId:
          payment.nominee_id ||
          null,

        message:
          "This Supabase payment is not present among successful Paystack transactions. Its payment record and associated votes will be removed when Apply Reconciliation is executed.",
      });
    }

    /*
     * =========================================
     * FINAL AMOUNT COMPARISON
     * =========================================
     */

    const differenceKobo =
      totalPaystackAmountKobo -
      totalSupabaseAmountKobo;

    /*
     * =========================================
     * FINAL VOTE COMPARISON
     * =========================================
     */

    const voteDifference =
      paystackSuccessfulVotes -
      supabaseSuccessfulVotes;

    /*
     * =========================================
     * RESPONSE
     * =========================================
     */

    return NextResponse.json({
      success: true,

      summary: {
        paystackTransactions:
          successfulPaystack.length,

        supabasePayments:
          supabasePayments.length,

        matched,

        missingPayment,

        missingVotes,

        amountMismatch,

        extraVotes,

        missingMetadata,

        paymentNotMarkedSuccess,

        supabaseOnly,

        /*
         * Amounts are in kobo.
         */
        totalPaystackAmountKobo,

        totalSupabaseAmountKobo,

        differenceKobo,

        /*
         * Vote comparison.
         */
        paystackSuccessfulVotes,

        supabaseSuccessfulVotes,

        voteDifference,
      },

      successfulAmountComparison: {
        paystackKobo:
          totalPaystackAmountKobo,

        supabaseKobo:
          totalSupabaseAmountKobo,

        differenceKobo,
      },

      successfulVoteComparison: {
        paystackVotes:
          paystackSuccessfulVotes,

        supabaseVotes:
          supabaseSuccessfulVotes,

        difference:
          voteDifference,
      },

      items,
    });
  } catch (error: any) {
    console.error(
      "RECONCILIATION ERROR:",
      error
    );

    return NextResponse.json(
      {
        success: false,

        error:
          error?.message ||
          "Could not reconcile payments.",
      },
      {
        status: 500,
      }
    );
  }
}
