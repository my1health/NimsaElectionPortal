import type { SupabaseClient } from "@supabase/supabase-js";

const VOTE_PRICE_KOBO = 100 * 100;

export type PaystackTransaction = {
  reference: string;
  status: string;
  amount: number;
  requested_amount?: number | null;
  paid_at?: string | null;
  transaction_date?: string | null;
  customer?: {
    email?: string | null;
  } | null;
  metadata?: any;
};

export type RecordResult =
  | {
      outcome: "recorded";
      voteCount: number;
      votesAdded: number;
      statusUpdated: boolean;
    }
  | {
      outcome:
        | "not_successful"
        | "amount_mismatch"
        | "manual_review";
      message: string;
    };

export async function verifyPaystackTransaction(
  reference: string
): Promise<PaystackTransaction> {
  const secretKey =
    process.env.PAYSTACK_SECRET_KEY;

  if (!secretKey) {
    throw new Error(
      "Paystack secret key is not configured."
    );
  }

  const response = await fetch(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(
      reference
    )}`,
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
    !result.data
  ) {
    throw new Error(
      result?.message ||
        `Could not verify ${reference} with Paystack.`
    );
  }

  return result.data;
}

export function transactionMetadata(
  transaction: PaystackTransaction
): Record<string, any> {
  let metadata = transaction.metadata;

  if (typeof metadata === "string") {
    try {
      metadata = JSON.parse(metadata);
    } catch {
      return {};
    }
  }

  return metadata && typeof metadata === "object"
    ? metadata
    : {};
}

// When transaction fees are passed on to the voter, Paystack's
// `amount` includes the fee and `requested_amount` is what we
// initialized the payment with.
export function paidAmountKobo(
  transaction: PaystackTransaction
) {
  return Number(
    transaction.requested_amount ||
      transaction.amount ||
      0
  );
}

export function amountMatches(
  transaction: PaystackTransaction,
  expectedKobo: number
) {
  return (
    Number(transaction.amount) === expectedKobo ||
    paidAmountKobo(transaction) === expectedKobo
  );
}

async function findPayment(
  db: SupabaseClient,
  reference: string
) {
  const { data, error } = await db
    .from("payments")
    .select("id, amount_kobo, status")
    .eq("reference", reference)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Could not load payment ${reference}: ${error.message}`
    );
  }

  return data;
}

// Records the votes for a transaction Paystack reports as successful.
//
// Safe to call any number of times, from the callback page, the webhook
// and reconciliation at once: record_payment_votes locks the payment row
// and only adds the votes that are still missing.
export async function recordPaidTransaction(
  db: SupabaseClient,
  transaction: PaystackTransaction
): Promise<RecordResult> {
  const reference = transaction.reference;

  if (
    String(transaction.status).toLowerCase() !==
    "success"
  ) {
    return {
      outcome: "not_successful",
      message: `Paystack reports this payment as "${transaction.status}".`,
    };
  }

  let payment = await findPayment(db, reference);

  // =========================================
  // PAYMENT ROW MISSING: REBUILD FROM METADATA
  // =========================================

  if (!payment) {
    const metadata =
      transactionMetadata(transaction);

    const nomineeId =
      metadata.nominee_id || metadata.nomineeId;

    const voteCount = Number(
      metadata.vote_count ??
        metadata.quantity ??
        metadata.votes
    );

    const email = String(
      metadata.email ||
        transaction.customer?.email ||
        ""
    )
      .trim()
      .toLowerCase();

    if (
      !nomineeId ||
      !email ||
      !Number.isInteger(voteCount) ||
      voteCount < 1
    ) {
      return {
        outcome: "manual_review",
        message:
          "Paystack confirms this payment, but there is no payment record and the Paystack metadata does not say which nominee or how many votes.",
      };
    }

    const { error } = await db
      .from("payments")
      .insert({
        reference,
        email,
        nominee_id: nomineeId,
        amount_kobo: voteCount * VOTE_PRICE_KOBO,
        vote_count: voteCount,
        status: "pending",
      });

    // 23503: the nominee no longer exists.
    if (error?.code === "23503") {
      return {
        outcome: "manual_review",
        message:
          "Paystack confirms this payment, but its nominee no longer exists.",
      };
    }

    // 23505: another request created the row first, which is fine.
    if (error && error.code !== "23505") {
      throw new Error(
        `Could not create payment ${reference}: ${error.message}`
      );
    }

    payment = await findPayment(db, reference);

    if (!payment) {
      throw new Error(
        `Payment ${reference} could not be loaded after it was created.`
      );
    }
  }

  // =========================================
  // VERIFY AMOUNT
  // =========================================

  const expectedKobo = Number(payment.amount_kobo);

  if (!amountMatches(transaction, expectedKobo)) {
    console.error("AMOUNT MISMATCH:", {
      reference,
      expectedKobo,
      amount: transaction.amount,
      requested_amount: transaction.requested_amount,
    });

    // Never downgrade a payment that has already been recorded.
    await db
      .from("payments")
      .update({ status: "amount_mismatch" })
      .eq("id", payment.id)
      .neq("status", "success");

    return {
      outcome: "amount_mismatch",
      message: `Paystack charged ₦${
        Number(transaction.amount) / 100
      }, but this payment expected ₦${expectedKobo / 100}.`,
    };
  }

  // =========================================
  // RECORD VOTES ATOMICALLY
  // =========================================

  const { data, error } = await db.rpc(
    "record_payment_votes",
    {
      p_reference: reference,
      p_paid_at:
        transaction.paid_at ||
        transaction.transaction_date ||
        new Date().toISOString(),
    }
  );

  if (error) {
    // PGRST202: the database function does not exist.
    const hint =
      error.code === "PGRST202"
        ? " Run supabase-fix-votes.sql in the Supabase SQL Editor."
        : "";

    throw new Error(
      `Could not record votes for ${reference}: ${error.message}.${hint}`
    );
  }

  if (data?.status !== "success") {
    return {
      outcome: "manual_review",
      message: `Votes could not be recorded (${data?.status}).`,
    };
  }

  return {
    outcome: "recorded",
    voteCount: Number(data.vote_count),
    votesAdded: Number(data.votes_added),
    statusUpdated: data.previous_status !== "success",
  };
}
