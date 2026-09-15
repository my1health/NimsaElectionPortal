import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY!;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

type PaystackTransaction = {
  id: number;
  reference: string;
  status: string;
  amount: number;
  currency?: string;
  customer?: {
    email?: string;
  };
  metadata?: any;
};

type PaymentRecord = {
  id: string;
  reference?: string | null;
  payment_reference?: string | null;
  status?: string | null;
  amount_kobo?: number | null;
  amount?: number | null;
  vote_count?: number | null;
  nominee_id?: string | null;
  category_id?: string | null;
  email?: string | null;
};

type VoteRecord = {
  id: string;
  payment_reference?: string | null;
  nominee_id?: string | null;
  category_id?: string | null;
};

type ReconciliationItem = {
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

async function fetchAllPaystackTransactions(): Promise<PaystackTransaction[]> {
  const allTransactions: PaystackTransaction[] = [];

  let page = 1;
  const perPage = 100;

  while (true) {
    const response = await fetch(
      `https://api.paystack.co/transaction?status=success&perPage=${perPage}&page=${page}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        cache: "no-store",
      }
    );

    if (!response.ok) {
      const text = await response.text();

      throw new Error(
        `Paystack request failed (${response.status}): ${text}`
      );
    }

    const data = await response.json();

    if (!data.status) {
      throw new Error(
        data.message || "Unable to retrieve Paystack transactions"
      );
    }

    const transactions = Array.isArray(data.data)
      ? data.data
      : [];

    allTransactions.push(...transactions);

    if (
      transactions.length < perPage ||
      page >= Number(data.meta?.pageCount || page)
    ) {
      break;
    }

    page++;
  }

  return allTransactions;
}

function getVoteCountFromPaystack(tx: PaystackTransaction) {
  const metadata = tx.metadata || {};

  const value =
    metadata.vote_count ??
    metadata.voteCount ??
    metadata.votes ??
    metadata.quantity ??
    0;

  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : 0;
}

function getNomineeIdFromPaystack(tx: PaystackTransaction) {
  const metadata = tx.metadata || {};

  return (
    metadata.nominee_id ??
    metadata.nomineeId ??
    null
  );
}

function getCategoryIdFromPaystack(tx: PaystackTransaction) {
  const metadata = tx.metadata || {};

  return (
    metadata.category_id ??
    metadata.categoryId ??
    null
  );
}

function getEmailFromPaystack(tx: PaystackTransaction) {
  return (
    tx.customer?.email ??
    tx.metadata?.email ??
    null
  );
}

export async function GET() {
  try {
    if (!PAYSTACK_SECRET_KEY) {
      return NextResponse.json(
        {
          error: "PAYSTACK_SECRET_KEY is not configured",
        },
        { status: 500 }
      );
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        {
          error: "Supabase service-role environment variables are missing",
        },
        { status: 500 }
      );
    }

    /*
     * IMPORTANT:
     * Paystack successful transactions are the source of truth.
     */
    const paystackTransactions =
      await fetchAllPaystackTransactions();

    /*
     * Get ALL Supabase payment records.
     *
     * We deliberately do not delete or modify Supabase-only records.
     */
    const { data: payments, error: paymentsError } =
      await supabase
        .from("payments")
        .select("*");

    if (paymentsError) {
      throw new Error(
        `Unable to load Supabase payments: ${paymentsError.message}`
      );
    }

    /*
     * Get all votes.
     */
    const { data: votes, error: votesError } =
      await supabase
        .from("votes")
        .select("*");

    if (votesError) {
      throw new Error(
        `Unable to load Supabase votes: ${votesError.message}`
      );
    }

    const paymentRecords: PaymentRecord[] =
      payments || [];

    const voteRecords: VoteRecord[] =
      votes || [];

    /*
     * Successful Paystack amount.
     */
    const totalPaystackAmountKobo =
      paystackTransactions.reduce(
        (total, transaction) =>
          total + Number(transaction.amount || 0),
        0
      );

    /*
     * IMPORTANT FIX:
     *
     * Only Supabase records whose status is actually "success"
     * are included in the successful-payment amount.
     *
     * Supabase-only records are NOT deleted or modified.
     */
    const totalSupabaseSuccessfulAmountKobo =
      paymentRecords.reduce((total, payment) => {
        const status = String(
          payment.status || ""
        ).toLowerCase();

        if (status !== "success") {
          return total;
        }

        return (
          total +
          Number(
            payment.amount_kobo ??
              payment.amount ??
              0
          )
        );
      }, 0);

    const items: ReconciliationItem[] = [];

    let ok = 0;
    let missingPayment = 0;
    let missingVotes = 0;
    let amountMismatch = 0;
    let extraVotes = 0;
    let missingMetadata = 0;
    let paymentNotMarkedSuccess = 0;

    /*
     * These references are used later only for information.
     */
    const successfulPaystackReferences =
      new Set<string>();

    for (const transaction of paystackTransactions) {
      const reference = transaction.reference;

      successfulPaystackReferences.add(reference);

      const paystackAmountKobo =
        Number(transaction.amount || 0);

      const paystackVoteCount =
        getVoteCountFromPaystack(transaction);

      const nomineeId =
        getNomineeIdFromPaystack(transaction);

      const categoryId =
        getCategoryIdFromPaystack(transaction);

      const email =
        getEmailFromPaystack(transaction);

      /*
       * Metadata is necessary for recovering votes/payment
       * when a Supabase record is missing.
       */
      if (
        !nomineeId ||
        !categoryId ||
        !paystackVoteCount
      ) {
        missingMetadata++;

        items.push({
          reference,
          issue: "missing_metadata",
          paystackAmountKobo,
          paystackVoteCount,
          nomineeId,
          categoryId,
          email,
          message:
            "Paystack transaction is successful but required voting metadata is missing.",
        });

        continue;
      }

      /*
       * Find payment by either reference column.
       */
      const payment =
        paymentRecords.find(
          (p) =>
            p.reference === reference ||
            p.payment_reference === reference
        );

      /*
       * No payment in Supabase.
       */
      if (!payment) {
        missingPayment++;

        items.push({
          reference,
          issue: "missing_payment",
          paystackAmountKobo,
          paystackVoteCount,
          nomineeId,
          categoryId,
          email,
          message:
            "Successful Paystack transaction has no corresponding Supabase payment.",
        });

        continue;
      }

      const supabaseAmountKobo =
        Number(
          payment.amount_kobo ??
            payment.amount ??
            0
        );

      /*
       * Paystack is the source of truth for status.
       *
       * If Paystack says success but Supabase says pending,
       * failed, processing, etc., flag it for correction.
       */
      const supabaseStatus =
        String(
          payment.status || ""
        ).toLowerCase();

      if (supabaseStatus !== "success") {
        paymentNotMarkedSuccess++;

        items.push({
          reference,
          issue: "payment_not_marked_success",
          paystackAmountKobo,
          supabaseAmountKobo,
          paystackVoteCount,
          nomineeId,
          categoryId,
          email,
          message:
            `Paystack is successful but Supabase payment status is "${payment.status}". It should be changed to "success".`,
        });

        /*
         * We continue checking the transaction.
         * This allows reconciliation to identify vote problems
         * as well.
         */
      }

      /*
       * Amount mismatch is always manual review.
       *
       * We do NOT automatically alter the amount.
       */
      if (
        supabaseAmountKobo !== paystackAmountKobo
      ) {
        amountMismatch++;

        items.push({
          reference,
          issue: "amount_mismatch",
          paystackAmountKobo,
          supabaseAmountKobo,
          paystackVoteCount,
          nomineeId,
          categoryId,
          email,
          message:
            "Paystack and Supabase amounts do not match. Manual review required.",
        });

        /*
         * Do not automatically manipulate votes based on money
         * differences.
         */
        continue;
      }

      /*
       * Count votes belonging to this payment.
       */
      const supabaseVoteCount =
        voteRecords.filter(
          (vote) =>
            vote.payment_reference === reference
        ).length;

      /*
       * Too many votes in Supabase.
       *
       * NEVER delete automatically.
       */
      if (
        supabaseVoteCount >
        paystackVoteCount
      ) {
        extraVotes++;

        items.push({
          reference,
          issue: "extra_votes",
          paystackAmountKobo,
          supabaseAmountKobo,
          paystackVoteCount,
          supabaseVoteCount,
          nomineeId,
          categoryId,
          email,
          message:
            "Supabase has more votes than Paystack metadata. No votes will be deleted automatically.",
        });

        continue;
      }

      /*
       * Some/all votes are missing.
       */
      if (
        supabaseVoteCount <
        paystackVoteCount
      ) {
        missingVotes++;

        items.push({
          reference,
          issue: "missing_votes",
          paystackAmountKobo,
          supabaseAmountKobo,
          paystackVoteCount,
          supabaseVoteCount,
          nomineeId,
          categoryId,
          email,
          message:
            `Supabase has ${supabaseVoteCount} vote(s), while Paystack metadata says ${paystackVoteCount}.`,
        });

        continue;
      }

      /*
       * Everything matches.
       *
       * Note that payment status may still need to be corrected,
       * so don't count it as fully OK if status wasn't success.
       */
      if (supabaseStatus === "success") {
        ok++;

        items.push({
          reference,
          issue: "ok",
          paystackAmountKobo,
          supabaseAmountKobo,
          paystackVoteCount,
          supabaseVoteCount,
          nomineeId,
          categoryId,
          email,
          message:
            "Paystack payment, Supabase payment and votes match.",
        });
      }
    }

    /*
     * Supabase-only records are deliberately NOT treated as
     * Paystack successful transactions.
     *
     * They are preserved exactly as they are.
     */
    const supabaseOnly =
      paymentRecords.filter((payment) => {
        const reference =
          payment.reference ??
          payment.payment_reference ??
          "";

        return (
          reference &&
          !successfulPaystackReferences.has(reference)
        );
      }).length;

    /*
     * Return reconciliation result.
     */
    return NextResponse.json({
      success: true,

      summary: {
        paystackTransactions:
          paystackTransactions.length,

        supabasePayments:
          paymentRecords.length,

        totalPaystackAmountKobo,

        /*
         * ONLY successful Supabase payment records.
         */
        totalSupabaseAmountKobo:
          totalSupabaseSuccessfulAmountKobo,

        ok,
        missingPayment,
        missingVotes,
        amountMismatch,
        extraVotes,
        missingMetadata,
        paymentNotMarkedSuccess,

        /*
         * Supabase-only records are informational only.
         * They are NOT modified by reconciliation.
         */
        supabaseOnly,
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
          "Reconciliation failed",
      },
      { status: 500 }
    );
  }
}
