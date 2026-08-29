import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Missing Supabase server environment variables.");
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function POST(req: Request) {
  try {
    const { reference } = await req.json();

    if (!reference) {
      return NextResponse.json(
        { error: "Payment reference is required." },
        { status: 400 }
      );
    }

    const db = getAdminClient();

    // -----------------------------------
    // FIND THE PAYMENT
    // -----------------------------------

    const { data: payment, error: paymentError } = await db
      .from("payments")
      .select(
        "id, reference, email, nominee_id, amount_kobo, vote_count, status"
      )
      .eq("reference", reference)
      .maybeSingle();

    if (paymentError) {
      throw paymentError;
    }

    if (!payment) {
      return NextResponse.json(
        { error: "Payment record not found." },
        { status: 404 }
      );
    }

    // -----------------------------------
    // PREVENT DOUBLE PROCESSING
    // -----------------------------------

    if (payment.status === "success") {
      return NextResponse.json({
        success: true,
        message: "Payment has already been processed.",
        votes: payment.vote_count,
      });
    }

    // -----------------------------------
    // VERIFY PAYMENT WITH PAYSTACK
    // -----------------------------------

    const secretKey = process.env.PAYSTACK_SECRET_KEY;

    if (!secretKey) {
      throw new Error("PAYSTACK_SECRET_KEY is not configured.");
    }

    const response = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(
        reference
      )}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/json",
        },
      }
    );

    const paystackData = await response.json();

    if (!response.ok || !paystackData.status) {
      return NextResponse.json(
        {
          error:
            paystackData.message ||
            "Unable to verify payment with Paystack.",
        },
        { status: 400 }
      );
    }

    const transaction = paystackData.data;

    // -----------------------------------
    // PAYMENT MUST BE SUCCESSFUL
    // -----------------------------------

    if (transaction.status !== "success") {
      await db
        .from("payments")
        .update({
          status: transaction.status || "failed",
        })
        .eq("reference", reference);

      return NextResponse.json(
        {
          error: "Payment was not successful.",
          status: transaction.status,
        },
        { status: 400 }
      );
    }

    // -----------------------------------
    // CONFIRM PAYMENT AMOUNT
    // -----------------------------------

    const expectedAmountKobo = Number(payment.amount_kobo);

    if (
      !Number.isInteger(expectedAmountKobo) ||
      expectedAmountKobo < 100
    ) {
      return NextResponse.json(
        { error: "Invalid payment amount in database." },
        { status: 500 }
      );
    }

    if (Number(transaction.amount) !== expectedAmountKobo) {
      await db
        .from("payments")
        .update({
          status: "amount_mismatch",
        })
        .eq("reference", reference);

      return NextResponse.json(
        {
          error:
            "Payment amount does not match the expected amount.",
        },
        { status: 400 }
      );
    }

    // -----------------------------------
    // GET NUMBER OF VOTES
    // -----------------------------------

    const votesToAdd = Number(payment.vote_count);

    if (!Number.isInteger(votesToAdd) || votesToAdd < 1) {
      return NextResponse.json(
        { error: "Invalid vote quantity." },
        { status: 500 }
      );
    }

    // -----------------------------------
    // GET NOMINEE + CATEGORY
    // -----------------------------------

    const { data: nominee, error: nomineeError } = await db
      .from("nominees")
      .select("id, category_id, is_active")
      .eq("id", payment.nominee_id)
      .maybeSingle();

    if (nomineeError) {
      throw nomineeError;
    }

    if (!nominee) {
      return NextResponse.json(
        { error: "Nominee not found." },
        { status: 404 }
      );
    }

    if (!nominee.is_active) {
      return NextResponse.json(
        { error: "This nominee is no longer available." },
        { status: 400 }
      );
    }

    // -----------------------------------
    // CREATE VOTE ROWS
    // -----------------------------------

    const voteRows = Array.from(
      { length: votesToAdd },
      () => ({
        nominee_id: payment.nominee_id,
        category_id: nominee.category_id,
        email: payment.email,
        payment_reference: reference,
      })
    );

    const { error: voteError } = await db
      .from("votes")
      .insert(voteRows);

    if (voteError) {
      throw voteError;
    }

    // -----------------------------------
    // MARK PAYMENT AS SUCCESSFUL
    // -----------------------------------

    const { error: updateError } = await db
      .from("payments")
      .update({
        status: "success",
        paid_at: new Date().toISOString(),
      })
      .eq("reference", reference);

    if (updateError) {
      throw updateError;
    }

    // -----------------------------------
    // SUCCESS
    // -----------------------------------

    return NextResponse.json({
      success: true,
      votes: votesToAdd,
      reference,
      message: `${votesToAdd} vote${
        votesToAdd === 1 ? "" : "s"
      } added successfully.`,
    });
  } catch (error: any) {
    console.error("Payment verification error:", error);

    return NextResponse.json(
      {
        error:
          error?.message ||
          "Something went wrong while verifying payment.",
      },
      { status: 500 }
    );
  }
}
