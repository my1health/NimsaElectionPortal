import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY!;

type PaystackTransaction = {
  reference: string;
  status: string;
  amount: number;
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

function metadataValue(metadata: any, keys: string[]) {
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

function toNumber(value: any): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}

function toStringValue(value: any): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  return String(value);
}

async function fetchAllPayments(): Promise<PaymentRow[]> {
  const all: PaymentRow[] = [];
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

    all.push(...(data as PaymentRow[]));

    if (data.length < pageSize) break;
  }

  return all;
}

async function fetchAllVotes(): Promise<VoteRow[]> {
  const all: VoteRow[] = [];
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

    all.push(...(data as VoteRow[]));

    if (data.length < pageSize) break;
  }

  return all;
}

async function fetchSuccessfulPaystackTransactions() {
  const all: PaystackTransaction[] = [];

  let page = 1;
  const perPage = 100;

  while (true) {
    const response = await fetch(
      `https://api.paystack.co/transaction?status=success&perPage=${perPage}&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        cache: "no-store",
      }
    );

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

    const transactions = Array.isArray(result.data)
      ? result.data
      : [];

    all.push(...transactions);

    if (transactions.length < perPage) {
      break;
    }

    page++;

    if (page > 100) {
      break;
    }
  }

  return all;
}

export async function GET() {
  try {
    if (!PAYSTACK_SECRET_KEY) {
      return NextResponse.json(
        {
          success: false,
          error: "PAYSTACK_SECRET_KEY is missing.",
        },
        { status: 500 }
      );
    }

    const [
      paystackTransactions,
      payments,
      votes,
    ] = await Promise.all([
      fetchSuccessfulPaystackTransactions(),
      fetchAllPayments(),
      fetchAllVotes(),
    ]);

    // ----------------------------------------------------------
    // PAYMENT INDEX
    // IMPORTANT: payments table uses "reference"
    // ----------------------------------------------------------

    const paymentByReference = new Map<
      string,
      PaymentRow
    >();

    for (const payment of payments) {
      if (!payment.reference) continue;

      if (!paymentByReference.has(payment.reference)) {
        paymentByReference.set(
          payment.reference,
          payment
        );
      }
    }

    // ----------------------------------------------------------
    // COUNT ACTUAL VOTE ROWS
    // ----------------------------------------------------------

    const votesByReference = new Map<string, number>();

    for (const vote of votes) {
      if (!vote.payment_reference) continue;

      votesByReference.set(
        vote.payment_reference,
        (votesByReference.get(vote.payment_reference) || 0) +
          1
      );
    }

    // ----------------------------------------------------------
    // SUMMARY
    // ----------------------------------------------------------

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

    const items: any[] = [];

    const successfulPaystackReferences =
      new Set<string>();

    // ----------------------------------------------------------
    // RECONCILE PAYSTACK SUCCESS TRANSACTIONS
    // ----------------------------------------------------------

    for (const transaction of paystackTransactions) {
      const reference = transaction.reference;

      if (!reference) continue;

      successfulPaystackReferences.add(reference);

      const paystackAmountKobo = Number(
        transaction.amount || 0
      );

      summary.totalPaystackAmountKobo +=
        paystackAmountKobo;

      const payment =
        paymentByReference.get(reference);

      const metadata = transaction.metadata || {};

      const nomineeId = toStringValue(
        metadataValue(metadata, [
          "nominee_id",
          "nomineeId",
          "nomineeID",
        ])
      );

      const categoryId = toStringValue(
        metadataValue(metadata, [
          "category_id",
          "categoryId",
          "categoryID",
        ])
      );

      const paystackVoteCount = toNumber(
        metadataValue(metadata, [
          "vote_count",
          "voteCount",
          "votes",
          "quantity",
        ])
      );

      const email =
        toStringValue(
          metadataValue(metadata, [
            "email",
            "customer_email",
          ])
        ) ||
        toStringValue(transaction.customer?.email);

      // --------------------------------------------------------
      // NO SUPABASE PAYMENT
      // --------------------------------------------------------

      if (!payment) {
        summary.missingPayment++;

        items.push({
          reference,
          issue: "missing_payment",

          paystackAmountKobo,

          supabaseAmountKobo: null,

          paystackVoteCount,
          supabaseVoteCount:
            votesByReference.get(reference) || 0,

          nomineeId,
          nomineeName: null,
          categoryId,
          email,

          message:
            "Paystack confirms SUCCESS but no Supabase payment record exists. The payment can be created and missing votes added.",
        });

        continue;
      }

      // --------------------------------------------------------
      // PAYSTACK SUCCESS ALWAYS MEANS SUPABASE SUCCESS
      // --------------------------------------------------------

      const supabaseStatus = String(
        payment.status || ""
      ).toLowerCase();

      if (supabaseStatus !== "success") {
        summary.paymentNotMarkedSuccess++;

        items.push({
          reference,
          issue: "payment_not_marked_success",

          paystackAmountKobo,

          supabaseAmountKobo: Number(
            payment.amount_kobo || 0
          ),

          paystackVoteCount,

          supabaseVoteCount:
            votesByReference.get(reference) || 0,

          nomineeId:
            nomineeId || payment.nominee_id || null,

          nomineeName: null,

          categoryId:
            categoryId || payment.category_id || null,

          email:
            email || payment.email || null,

          message:
            `Paystack says SUCCESS but Supabase says "${payment.status}". Supabase status should be changed to SUCCESS.`,
        });
      }

      // --------------------------------------------------------
      // AMOUNT CHECK
      // --------------------------------------------------------

      const supabaseAmountKobo = Number(
        payment.amount_kobo || 0
      );

      if (
        supabaseAmountKobo !==
        paystackAmountKobo
      ) {
        summary.amountMismatch++;

        items.push({
          reference,
          issue: "amount_mismatch",

          paystackAmountKobo,
          supabaseAmountKobo,

          paystackVoteCount,

          supabaseVoteCount:
            votesByReference.get(reference) || 0,

          nomineeId:
            nomineeId || payment.nominee_id || null,

          nomineeName: null,

          categoryId:
            categoryId || payment.category_id || null,

          email:
            email || payment.email || null,

          message:
            "Amount differs between Paystack and Supabase. Status can still be synchronized to SUCCESS, but votes will not be automatically changed because the amount requires review.",
        });

        continue;
      }

      // --------------------------------------------------------
      // METADATA CHECK
      // --------------------------------------------------------

      if (
        !nomineeId ||
        !categoryId ||
        paystackVoteCount === null
      ) {
        summary.missingMetadata++;

        items.push({
          reference,
          issue: "missing_metadata",

          paystackAmountKobo,
          supabaseAmountKobo,

          paystackVoteCount,

          supabaseVoteCount:
            votesByReference.get(reference) || 0,

          nomineeId:
            nomineeId || payment.nominee_id || null,

          nomineeName: null,

          categoryId:
            categoryId || payment.category_id || null,

          email:
            email || payment.email || null,

          message:
            "Required Paystack voting metadata is missing. No votes will be changed automatically.",
        });

        continue;
      }

      // --------------------------------------------------------
      // ACTUAL VOTES
      // --------------------------------------------------------

      const actualVoteCount =
        votesByReference.get(reference) || 0;

      // Add-only reconciliation.
      if (actualVoteCount < paystackVoteCount) {
        summary.missingVotes++;

        items.push({
          reference,
          issue: "missing_votes",

          paystackAmountKobo,
          supabaseAmountKobo,

          paystackVoteCount,
          supabaseVoteCount: actualVoteCount,

          nomineeId:
            nomineeId || payment.nominee_id || null,

          nomineeName: null,

          categoryId:
            categoryId || payment.category_id || null,

          email:
            email || payment.email || null,

          message:
            `Paystack indicates ${paystackVoteCount} vote(s), while Supabase has ${actualVoteCount}. Only the missing ${paystackVoteCount - actualVoteCount} vote(s) will be added.`,
        });

        continue;
      }

      // --------------------------------------------------------
      // EXTRA SUPABASE VOTES
      // NEVER DELETE THEM
      // --------------------------------------------------------

      if (actualVoteCount > paystackVoteCount) {
        summary.extraVotes++;

        items.push({
          reference,
          issue: "extra_votes",

          paystackAmountKobo,
          supabaseAmountKobo,

          paystackVoteCount,
          supabaseVoteCount: actualVoteCount,

          nomineeId:
            nomineeId || payment.nominee_id || null,

          nomineeName: null,

          categoryId:
            categoryId || payment.category_id || null,

          email:
            email || payment.email || null,

          message:
            "Supabase has more votes than Paystack metadata. EXTRA VOTES ARE LEFT COMPLETELY UNTOUCHED. No votes will be deleted.",
        });

        continue;
      }

      // --------------------------------------------------------
      // PERFECT MATCH
      // --------------------------------------------------------

      summary.ok++;

      items.push({
        reference,
        issue: "ok",

        paystackAmountKobo,
        supabaseAmountKobo,

        paystackVoteCount,
        supabaseVoteCount: actualVoteCount,

        nomineeId:
          nomineeId || payment.nominee_id || null,

        nomineeName: null,

        categoryId:
          categoryId || payment.category_id || null,

        email:
          email || payment.email || null,

        message:
          "Paystack SUCCESS, Supabase SUCCESS and vote count match.",
      });
    }

    // ----------------------------------------------------------
    // SUPABASE-ONLY PAYMENTS
    //
    // THESE ARE NEVER CHANGED.
    // ----------------------------------------------------------

    for (const payment of payments) {
      const reference = payment.reference;

      if (!reference) continue;

      if (
        !successfulPaystackReferences.has(reference)
      ) {
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
            votesByReference.get(reference) || 0,

          nomineeId: payment.nominee_id || null,
          nomineeName: null,
          categoryId: payment.category_id || null,
          email: payment.email || null,

          message:
            "No successful Paystack transaction was found for this reference. Supabase payment and votes are LEFT COMPLETELY UNTOUCHED.",
        });
      }
    }

    // ----------------------------------------------------------
    // SUCCESSFUL SUPABASE AMOUNT
    //
    // Only payments that ALSO have a successful Paystack
    // transaction are included here.
    // ----------------------------------------------------------

    summary.totalSupabaseAmountKobo = 0;

    for (const payment of payments) {
      if (!payment.reference) continue;

      if (
        !successfulPaystackReferences.has(
          payment.reference
        )
      ) {
        continue;
      }

      if (
        String(payment.status || "").toLowerCase() ===
        "success"
      ) {
        summary.totalSupabaseAmountKobo += Number(
          payment.amount_kobo || 0
        );
      }
    }

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
    console.error(
      "PAYSTACK RECONCILIATION ERROR:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error?.message ||
          "Reconciliation failed.",
      },
      { status: 500 }
    );
  }
}
