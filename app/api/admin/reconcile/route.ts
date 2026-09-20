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
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error("Supabase server environment variables are missing.");
  }

  return createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

type PaymentRow = {
  id: string;
  reference: string;
  email?: string | null;
  nominee_id?: string | null;
  category_id?: string | null;
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

function toNumber(value: unknown): number | null {
  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}

function toStringValue(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const valueString = String(value).trim();

  return valueString || null;
}

async function fetchAllPayments(
  db: ReturnType<typeof createAdminClient>
): Promise<PaymentRow[]> {
  const rows: PaymentRow[] = [];
  let from = 0;

  while (true) {
    const to = from + 999;

    const { data, error } = await db
      .from("payments")
      .select(
        `
        id,
        reference,
        email,
        nominee_id,
        category_id,
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

    rows.push(...((data || []) as PaymentRow[]));

    if (!data || data.length < 1000) {
      break;
    }

    from += 1000;
  }

  return rows;
}

async function fetchAllVotes(
  db: ReturnType<typeof createAdminClient>
): Promise<VoteRow[]> {
  const rows: VoteRow[] = [];
  let from = 0;

  while (true) {
    const to = from + 999;

    const { data, error } = await db
      .from("votes")
      .select("id, payment_reference")
      .range(from, to);

    if (error) {
      throw new Error(
        `Could not load Supabase votes: ${error.message}`
      );
    }

    rows.push(...((data || []) as VoteRow[]));

    if (!data || data.length < 1000) {
      break;
    }

    from += 1000;
  }

  return rows;
}

async function fetchSuccessfulPaystackTransactions(): Promise<
  PaystackTransaction[]
> {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;

  if (!secretKey) {
    throw new Error("PAYSTACK_SECRET_KEY is not configured.");
  }

  const transactions: PaystackTransaction[] = [];

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

    const result = await response.json().catch(() => null);

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

export async function GET() {
  try {
    const db = createAdminClient();

    const [
      successfulPaystack,
      supabasePayments,
      supabaseVotes,
    ] = await Promise.all([
      fetchSuccessfulPaystackTransactions(),
      fetchAllPayments(db),
      fetchAllVotes(db),
    ]);

    const paymentByReference = new Map<string, PaymentRow>();

    for (const payment of supabasePayments) {
      paymentByReference.set(payment.reference, payment);
    }

    const votesByReference = new Map<string, VoteRow[]>();

    for (const vote of supabaseVotes) {
      if (!vote.payment_reference) {
        continue;
      }

      const current =
        votesByReference.get(vote.payment_reference) || [];

      current.push(vote);

      votesByReference.set(
        vote.payment_reference,
        current
      );
    }

    const paystackReferences = new Set(
      successfulPaystack.map(
        (transaction) => transaction.reference
      )
    );

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

    let paystackSuccessfulVotes = 0;
    let supabaseSuccessfulVotes = 0;

    /*
     * =========================================
     * SUCCESSFUL PAYSTACK TRANSACTIONS
     * =========================================
     */

    for (const transaction of successfulPaystack) {
      const reference = transaction.reference;

      const paystackAmountKobo =
        paidAmountKobo(transaction);

      totalPaystackAmountKobo += paystackAmountKobo;

      const metadata =
        transactionMetadata(transaction);

      const nomineeId = toStringValue(
        metadataValue(
          metadata,
          "nominee_id",
          "nomineeId"
        )
      );

      const metadataVoteCount = toNumber(
        metadataValue(
          metadata,
          "vote_count",
          "voteCount",
          "votes",
          "quantity"
        )
      );

      /*
       * Because this project charges exactly ₦100 per vote,
       * derive the expected count from the Paystack requested
       * amount when possible.
       */
      const amountDerivedVoteCount =
        paystackAmountKobo > 0 &&
        paystackAmountKobo % VOTE_PRICE_KOBO === 0
          ? paystackAmountKobo / VOTE_PRICE_KOBO
          : null;

      const expectedVoteCount =
        metadataVoteCount ||
        amountDerivedVoteCount;

      if (expectedVoteCount) {
        paystackSuccessfulVotes += expectedVoteCount;
      }

      const payment =
        paymentByReference.get(reference);

      /*
       * Payment completely missing from Supabase.
       */
      if (!payment) {
        missingPayment++;

        items.push({
          reference,
          type: "missing_payment",
          status: "missing",
          paystackAmountKobo,
          expectedVotes: expectedVoteCount,
          nomineeId,
          message:
            "Successful Paystack transaction has no Supabase payment record.",
        });

        continue;
      }

      const supabaseAmountKobo =
        Number(payment.amount_kobo || 0);

      /*
       * Only successful Supabase payment rows count
       * toward the current site total.
       */
      if (
        String(payment.status).toLowerCase() ===
        "success"
      ) {
        totalSupabaseAmountKobo +=
          supabaseAmountKobo;
      }

      const actualVotes =
        votesByReference.get(reference)?.length || 0;

      if (
        String(payment.status).toLowerCase() !==
        "success"
      ) {
        paymentNotMarkedSuccess++;

        items.push({
          reference,
          type: "payment_not_marked_success",
          status: "repair",
          paystackAmountKobo,
          supabaseAmountKobo,
          expectedVotes: expectedVoteCount,
          actualVotes,
          nomineeId:
            nomineeId || payment.nominee_id,
          message:
            "Paystack reports success but the Supabase payment is not marked success.",
        });

        continue;
      }

      /*
       * Paystack requested amount is authoritative.
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
          type: "amount_mismatch",
          status: "repair",
          paystackAmountKobo,
          supabaseAmountKobo,
          expectedVotes: expectedVoteCount,
          actualVotes,
          nomineeId:
            nomineeId || payment.nominee_id,
          message:
            "Supabase amount does not match the Paystack successful transaction.",
        });

        continue;
      }

      /*
       * Missing metadata only matters when we cannot
       * determine the nominee / vote count safely.
       */
      const finalExpectedVotes =
        Number.isInteger(expectedVoteCount) &&
        Number(expectedVoteCount) > 0
          ? Number(expectedVoteCount)
          : Number(payment.vote_count || 0);

      const finalNomineeId =
        nomineeId || payment.nominee_id || null;

      if (
        !finalNomineeId ||
        !Number.isInteger(finalExpectedVotes) ||
        finalExpectedVotes < 1
      ) {
        missingMetadata++;

        items.push({
          reference,
          type: "missing_metadata",
          status: "manual_review",
          paystackAmountKobo,
          supabaseAmountKobo,
          expectedVotes: finalExpectedVotes,
          actualVotes,
          nomineeId: finalNomineeId,
          message:
            "The payment is successful but nominee/vote information cannot be safely determined.",
        });

        continue;
      }

      if (actualVotes < finalExpectedVotes) {
        missingVotes++;

        items.push({
          reference,
          type: "missing_votes",
          status: "repair",
          paystackAmountKobo,
          supabaseAmountKobo,
          expectedVotes: finalExpectedVotes,
          actualVotes,
          missingVoteCount:
            finalExpectedVotes - actualVotes,
          nomineeId: finalNomineeId,
          message:
            "Some vote rows are missing for this successful payment.",
        });

        continue;
      }

      if (actualVotes > finalExpectedVotes) {
        extraVotes++;

        /*
         * IMPORTANT:
         * We intentionally do not delete these here.
         * They belong to a legitimate Paystack reference.
         */
        items.push({
          reference,
          type: "extra_votes",
          status: "review",
          paystackAmountKobo,
          supabaseAmountKobo,
          expectedVotes: finalExpectedVotes,
          actualVotes,
          extraVoteCount:
            actualVotes - finalExpectedVotes,
          nomineeId: finalNomineeId,
          message:
            "Supabase contains more vote rows than expected for this valid Paystack payment. No votes were deleted automatically.",
        });

        continue;
      }

      supabaseSuccessfulVotes += actualVotes;

      items.push({
        reference,
        type: "ok",
        status: "ok",
        paystackAmountKobo,
        supabaseAmountKobo,
        expectedVotes: finalExpectedVotes,
        actualVotes,
        nomineeId: finalNomineeId,
      });
    }

    /*
     * =========================================
     * SUPABASE-ONLY PAYMENTS
     *
     * These are payments that do NOT exist among
     * successful Paystack transactions.
     *
     * They will be deleted when Apply Reconciliation
     * is run.
     * =========================================
     */

    for (const payment of supabasePayments) {
      if (paystackReferences.has(payment.reference)) {
        continue;
      }

      supabaseOnly++;

      const associatedVotes =
        votesByReference.get(payment.reference)
          ?.length || 0;

      items.push({
        reference: payment.reference,
        type: "supabase_only",
        status: "delete",
        supabaseAmountKobo: Number(
          payment.amount_kobo || 0
        ),
        actualVotes: associatedVotes,
        nomineeId: payment.nominee_id,
        message:
          "This Supabase payment is not present among successful Paystack transactions. Its payment record and associated votes will be removed during Apply Reconciliation.",
      });
    }

    /*
     * =========================================
     * FINAL SUMMARY
     * =========================================
     */

    const matched =
      successfulPaystack.length -
      missingPayment;

    const difference =
      totalPaystackAmountKobo -
      totalSupabaseAmountKobo;

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

        totalPaystackAmountKobo,

        totalSupabaseAmountKobo,

        differenceKobo: difference,

        paystackSuccessfulVotes,

        supabaseSuccessfulVotes,
      },

      successfulAmountComparison: {
        paystackKobo:
          totalPaystackAmountKobo,

        supabaseKobo:
          totalSupabaseAmountKobo,

        differenceKobo: difference,
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
      { status: 500 }
    );
  }
}
