import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Missing Supabase server environment variables.");
  }

  return createClient(url, key);
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

    // Find our pending payment
    const { data: payment, error: paymentError } = await db
      .from("payments")
      .select("*")
      .eq("payment_reference", reference)
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

    // Prevent the same payment from being processed twice.
    if (payment.status === "success") {
      return NextResponse.json({
        success: true,
        message: "Payment has already been processed.",
      });
    }

    // Verify transaction with Paystack
    const response = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(
        reference
      )}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      }
    );

    const paystackData = await response.json();

    if (!response.ok || !paystackData.status) {
      return NextResponse.json(
        {
          error:
            paystackData.message ||
            "Unable to verify payment.",
        },
        { status: 400 }
      );
    }

    const transaction = paystackData.data;

    // Payment must actually be successful.
    if (transaction.status !== "success") {
      await db
        .from("payments")
        .update({ status: transaction.status || "failed" })
        .eq("payment_reference", reference);

      return NextResponse.json(
        {
          error: "Payment was not successful.",
          status: transaction.status,
        },
        { status: 400 }
      );
    }

    // Confirm the amount paid matches the amount we expected.
    const expectedAmount = Number(payment.amount) * 100;

    if (Number(transaction.amount) !== expectedAmount) {
      await db
        .from("payments")
        .update({ status: "amount_mismatch" })
        .eq("payment_reference", reference);

      return NextResponse.json(
        { error: "Payment amount does not match the expected amount." },
        { status: 400 }
      );
    }

    /*
     * IMPORTANT:
     * Only now do we create the votes.
     */

    const votesToAdd = Number(payment.votes);

    if (!Number.isInteger(votesToAdd) || votesToAdd < 1) {
      return NextResponse.json(
        { error: "Invalid vote quantity." },
        { status: 400 }
      );
    }

    // Insert one vote row for each purchased vote.
    const voteRows = Array.from(
      { length: votesToAdd },
      () => ({
        nominee_id: payment.nominee_id,
        category_id: payment.category_id,
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

    // Mark payment as successfully processed.
    const { error: updateError } = await db
      .from("payments")
      .update({
        status: "success",
      })
      .eq("payment_reference", reference);

    if (updateError) {
      throw updateError;
    }

    return NextResponse.json({
      success: true,
      votes: votesToAdd,
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
