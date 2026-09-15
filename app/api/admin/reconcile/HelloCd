import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY!;

type PaystackTransaction = {
  id?: number;
  reference: string;
  status: string;
  amount: number;
  currency?: string;
  paid_at?: string | null;
  transaction_date?: string | null;
  customer?: {
    email?: string | null;
  };
  metadata?: any;
};

type PaymentRow = {
  id: string;
  reference: string;
  payment_reference?: string | null;
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
  nominee_id?: string | null;
  category_id?: string | null;
  email?: string | null;
  payment_reference?: string | null;
  created_at?: string | null;
};

function getMetadataValue(metadata: any, keys: string[]) {
  if (!metadata || typeof metadata !== "object") return null;

  for (const key of keys) {
    if (
      metadata[key] !== undefined &&
      metadata[key] !== null &&
      metadata[key] !== ""
    ) {
      return metadata[key];
    }
  }

  return null;
}

function numberValue(value: any): number | null {
  if (value === null || value === undefined || value === "") return null;

  const n = Number(value);

  return Number.isFinite(n) ? n : null;
}

function stringValue(value: any): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

async function getAllPayments(): Promise<PaymentRow[]> {
  const rows: PaymentRow[] = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("payments")
      .select("*")
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(`Could not load payments: ${error.message}`);
    }

    if (!data || data.length === 0) break;

    rows.push(...(data as PaymentRow[]));

    if (data.length < pageSize) break;
  }

  return rows;
}

async function getAllVotes(): Promise<VoteRow[]> {
  const rows: VoteRow[] = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("votes")
      .select("*")
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(`Could not load votes: ${error.message}`);
    }

    if (!data || data.length === 0) break;

    rows.push(...(data as VoteRow[]));

    if (data.length < pageSize) break;
  }

  return rows;
}

async function getPaystackSuccessfulTransactions(): Promise<
  PaystackTransaction[]
> {
  const transactions: PaystackTransaction[] = [];

  let page = 1;
  const perPage = 100;

  while (true) {
    const url =
      `https://api.paystack.co/transaction?status=success` +
      `&perPage=${perPage}&page=${page}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    const text = await response.text();

    let result: any;

    try {
      result = JSON.parse(text);
    } catch {
      throw new Error(
        `Paystack returned an invalid response on page ${page}.`
      );
    }

    if (!response.ok || !result.status) {
      throw new Error(
        result?.message ||
          `Paystack request failed with status ${response.status}.`
      );
    }

    const data = Array.isArray(result.data) ? result.data : [];

    transactions.push(...data);

    if (data.length < perPage) break;

    page++;

    // Safety limit
    if (page > 100) break;
  }

  return transactions;
}

export async function GET() {
  try {
    if (!PAYSTACK_SECRET_KEY) {
      return NextResponse.json(
        {
          error: "PAYSTACK_SECRET_KEY is missing.",
        },
        { status: 500 }
      );
    }

    if (
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.SUPABASE_SERVICE_ROLE_KEY
    ) {
      return NextResponse.json(
        {
          error: "Supabase environment variables are missing.",
        },
        { status: 500 }
      );
    }

    // ------------------------------------------------------------
    // LOAD PAYSTACK + SUPABASE DATA
    // ------------------------------------------------------------

    const [paystackTransactions, payments, votes] = await Promise.all([
      getPaystackSuccessfulTransactions(),
      getAllPayments(),
      getAllVotes(),
    ]);

    // ------------------------------------------------------------
    // INDEX SUPABASE PAYMENTS
    // ------------------------------------------------------------

    const paymentByReference = new Map<string, PaymentRow>();

    for (const payment of payments) {
      const references = [
        payment.reference,
        payment.payment_reference,
      ].filter(Boolean) as string[];

      for (const reference of references) {
        if (!paymentByReference.has(reference)) {
          paymentByReference.set(reference, payment);
        }
      }
    }

    // ------------------------------------------------------------
    // COUNT ACTUAL VOTE ROWS BY PAYMENT REFERENCE
    // ------------------------------------------------------------

    const voteCountByReference = new Map<string, number>();

    for (const vote of votes) {
      const reference = vote.payment_reference;

      if (!reference) continue;

      voteCountByReference.set(
        reference,
        (voteCountByReference.get(reference) || 0) + 1
      );
    }

    // ------------------------------------------------------------
    // SUMMARY
    // ------------------------------------------------------------

    const summary = {
      paystackTransactions: paystackTransactions.length,
      supabasePayments: payments.length,

      totalPaystackAmountKobo: 0,
      totalSupabaseAmountKobo: 0,

      ok: 0,
      missingPayment: 0,
      missingVotes: 0,
      amountMismatch: 0,
      extraVotes: 0,
      missingMetadata: 0,
      paymentNotMarkedSuccess: 0,
      supabaseOnly: 0,
    };

    // ------------------------------------------------------------
    // ONLY SUPABASE SUCCESS PAYMENTS ARE INCLUDED IN THE
    // SUCCESSFUL AMOUNT COMPARISON.
    // ------------------------------------------------------------

    for (const payment of payments) {
      if (String(payment.status || "").toLowerCase() === "success") {
        summary.totalSupabaseAmountKobo += Number(
          payment.amount_kobo || 0
        );
      }
    }

    const items: any[] = [];

    // Keep track of Paystack references.
    const successfulPaystackReferences = new Set<string>();

    // ------------------------------------------------------------
    // RECONCILE EVERY SUCCESSFUL PAYSTACK TRANSACTION
    // ------------------------------------------------------------

    for (const transaction of paystackTransactions) {
      const reference = transaction.reference;

      if (!reference) continue;

      successfulPaystackReferences.add(reference);

      const paystackAmountKobo = Number(transaction.amount || 0);

      summary.totalPaystackAmountKobo += paystackAmountKobo;

      const payment = paymentByReference.get(reference);

      const metadata = transaction.metadata || {};

      const nomineeId = stringValue(
        getMetadataValue(metadata, [
          "nominee_id",
          "nomineeId",
          "nomineeID",
        ])
      );

      const categoryId = stringValue(
        getMetadataValue(metadata, [
          "category_id",
          "categoryId",
          "categoryID",
        ])
      );

      const voteCount = numberValue(
        getMetadataValue(metadata, [
          "vote_count",
          "voteCount",
          "votes",
          "quantity",
        ])
      );

      const email =
        stringValue(
          getMetadataValue(metadata, ["email", "customer_email"])
        ) ||
        stringValue(transaction.customer?.email);

      // ----------------------------------------------------------
      // MISSING PAYMENT
      // ----------------------------------------------------------

      if (!payment) {
        if (!nomineeId || !categoryId || voteCount === null) {
          summary.missingMetadata++;

          items.push({
            reference,
            issue: "missing_metadata",

            paystackAmountKobo,

            supabaseAmountKobo: null,

            paystackVoteCount: voteCount,
            supabaseVoteCount: 0,

            nomineeId,
            nomineeName: null,
            categoryId,
            email,

            message:
              "Paystack payment is successful but the Supabase payment record is missing and required voting metadata is incomplete. Manual review required.",
          });

          continue;
        }

        summary.missingPayment++;

        items.push({
          reference,
          issue: "missing_payment",

          paystackAmountKobo,

          supabaseAmountKobo: null,

          paystackVoteCount: voteCount,
          supabaseVoteCount: 0,

          nomineeId,
          nomineeName: null,
          categoryId,
          email,

          message:
            "Successful Paystack transaction has no matching Supabase payment record. Safe recovery can create the payment and recover its votes.",
        });

        continue;
      }

      // ----------------------------------------------------------
      // PAYMENT EXISTS
      // ----------------------------------------------------------

      const supabaseAmountKobo = Number(payment.amount_kobo || 0);

      const currentStatus = String(
        payment.status || ""
      ).toLowerCase();

      const actualVoteCount =
        voteCountByReference.get(reference) || 0;

      // ----------------------------------------------------------
      // PAYSTACK SUCCESS BUT SUPABASE NOT SUCCESS
      // ----------------------------------------------------------

      if (currentStatus !== "success") {
        summary.paymentNotMarkedSuccess++;

        items.push({
          reference,
          issue: "payment_not_marked_success",

          paystackAmountKobo,
          supabaseAmountKobo,

          paystackVoteCount: voteCount,
          supabaseVoteCount: actualVoteCount,

          nomineeId:
            nomineeId || payment.nominee_id || null,

          nomineeName: null,

          categoryId:
            categoryId || payment.category_id || null,

          email:
            email || payment.email || null,

          message:
            `Paystack confirms this transaction as SUCCESS, but Supabase currently says "${payment.status}". The payment status should be synchronized to success.`,
        });
      }

      // ----------------------------------------------------------
      // AMOUNT MISMATCH
      // ----------------------------------------------------------

      if (supabaseAmountKobo !== paystackAmountKobo) {
        summary.amountMismatch++;

        items.push({
          reference,
          issue: "amount_mismatch",

          paystackAmountKobo,
          supabaseAmountKobo,

          paystackVoteCount: voteCount,
          supabaseVoteCount: actualVoteCount,

          nomineeId:
            nomineeId || payment.nominee_id || null,

          nomineeName: null,

          categoryId:
            categoryId || payment.category_id || null,

          email:
            email || payment.email || null,

          message:
            "Paystack and Supabase amounts do not match. Payment status may be synchronized, but votes must NOT be automatically changed until the amount discrepancy is reviewed.",
        });

        // IMPORTANT:
        // Do not calculate or add votes when the amount is wrong.
        continue;
      }

      // ----------------------------------------------------------
      // MISSING PAYSTACK METADATA
      // ----------------------------------------------------------

      if (!nomineeId || !categoryId || voteCount === null) {
        summary.missingMetadata++;

        items.push({
          reference,
          issue: "missing_metadata",

          paystackAmountKobo,
          supabaseAmountKobo,

          paystackVoteCount: voteCount,
          supabaseVoteCount: actualVoteCount,

          nomineeId:
            nomineeId || payment.nominee_id || null,

          nomineeName: null,

          categoryId:
            categoryId || payment.category_id || null,

          email:
            email || payment.email || null,

          message:
            "Payment amount matches, but Paystack voting metadata is incomplete. Manual review required before changing votes.",
        });

        continue;
      }

      // ----------------------------------------------------------
      // ACTUAL VOTE COUNT IS TOO LOW
      // ----------------------------------------------------------

      if (actualVoteCount < voteCount) {
        const missing = voteCount - actualVoteCount;

        summary.missingVotes++;

        items.push({
          reference,
          issue: "missing_votes",

          paystackAmountKobo,
          supabaseAmountKobo,

          paystackVoteCount: voteCount,
          supabaseVoteCount: actualVoteCount,

          nomineeId:
            nomineeId || payment.nominee_id || null,

          nomineeName: null,

          categoryId:
            categoryId || payment.category_id || null,

          email:
            email || payment.email || null,

          message:
            `${missing} vote(s) are missing from Supabase for this successful Paystack transaction. Only the missing votes will be added.`,
        });

        continue;
      }

      // ----------------------------------------------------------
      // MORE VOTES EXIST THAN PAYSTACK
      // ----------------------------------------------------------

      if (actualVoteCount > voteCount) {
        summary.extraVotes++;

        items.push({
          reference,
          issue: "extra_votes",

          paystackAmountKobo,
          supabaseAmountKobo,

          paystackVoteCount: voteCount,
          supabaseVoteCount: actualVoteCount,

          nomineeId:
            nomineeId || payment.nominee_id || null,

          nomineeName: null,

          categoryId:
            categoryId || payment.category_id || null,

          email:
            email || payment.email || null,

          message:
            "Supabase contains more vote rows than Paystack metadata indicates. No votes will be deleted automatically. Manual investigation required.",
        });

        continue;
      }

      // ----------------------------------------------------------
      // EVERYTHING MATCHES
      // ----------------------------------------------------------

      summary.ok++;

      items.push({
        reference,
        issue: "ok",

        paystackAmountKobo,
        supabaseAmountKobo,

        paystackVoteCount: voteCount,
        supabaseVoteCount: actualVoteCount,

        nomineeId:
          nomineeId || payment.nominee_id || null,

        nomineeName: null,

        categoryId:
          categoryId || payment.category_id || null,

        email:
          email || payment.email || null,

        message:
          "Paystack payment, Supabase payment amount and actual vote count match.",
      });
    }

    // ------------------------------------------------------------
    // SUPABASE-ONLY PAYMENTS
    //
    // IMPORTANT:
    // THESE ARE INFORMATIONAL ONLY.
    // WE DO NOT CHANGE THEM.
    // ------------------------------------------------------------

    for (const payment of payments) {
      const reference =
        payment.reference || payment.payment_reference;

      if (!reference) continue;

      if (!successfulPaystackReferences.has(reference)) {
        summary.supabaseOnly++;

        items.push({
          reference,
          issue: "supabase_only",

          paystackAmountKobo: null,
          supabaseAmountKobo: Number(
            payment.amount_kobo || 0
          ),

          paystackVoteCount: null,
          supabaseVoteCount:
            voteCountByReference.get(reference) || 0,

          nomineeId: payment.nominee_id || null,
          nomineeName: null,
          categoryId: payment.category_id || null,
          email: payment.email || null,

          message:
            "This Supabase payment has no matching successful Paystack transaction. It has NOT been changed.",
        });
      }
    }

    // ------------------------------------------------------------
    // FINAL RESULT
    // ------------------------------------------------------------

    return NextResponse.json({
      success: true,

      summary,

      successfulAmountComparison: {
        paystackAmountKobo:
          summary.totalPaystackAmountKobo,

        supabaseSuccessfulAmountKobo:
          summary.totalSupabaseAmountKobo,

        differenceKobo:
          summary.totalPaystackAmountKobo -
          summary.totalSupabaseAmountKobo,

        differenceNaira:
          (
            (summary.totalPaystackAmountKobo -
              summary.totalSupabaseAmountKobo) /
            100
          ).toFixed(2),
      },

      items,
    });
  } catch (error: any) {
    console.error("RECONCILIATION ERROR:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error?.message ||
          "An unexpected reconciliation error occurred.",
      },
      { status: 500 }
    );
  }
}
