import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const reference = searchParams.get("reference");

    if (!reference) {
      return NextResponse.json(
        { error: "Payment reference is required." },
        { status: 400 }
      );
    }

    const secretKey = process.env.PAYSTACK_SECRET_KEY;

    if (!secretKey) {
      return NextResponse.json(
        { error: "Paystack secret key is not configured." },
        { status: 500 }
      );
    }

    const db = supabaseAdmin();

    // Find payment
    const { data: payment, error: paymentError } =
      await db
        .from("payments")
        .select("*")
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

    // Already successfully processed
    if (payment.status === "success") {
      return NextResponse.json({
        success: true,
        message: "Payment has already been processed.",
        votes: payment.vote_count,
        reference
      });
    }

    // Verify with Paystack
    const response = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(
        reference
      )}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/json"
        },
        cache: "no-store"
      }
    );

    const paystackData = await response.json();

    if (!response.ok || !paystackData.status) {
      return NextResponse.json(
        {
          error:
            paystackData.message ||
            "Unable to verify payment."
        },
        { status: 400 }
      );
    }

    const transaction = paystackData.data;

    // Payment must be successful
    if (transaction.status !== "success") {
      await db
        .from("payments")
        .update({
          status: "failed"
        })
        .eq("reference", reference)
        .eq("status", "pending");

      return NextResponse.json({
        success: false,
        message: "Payment was not successful.",
        payment_status: transaction.status
      });
    }

    // Verify amount
    if (
      Number(transaction.amount) !==
      Number(payment.amount_kobo)
    ) {
      return NextResponse.json(
        {
          error:
            "Payment amount does not match the expected amount."
        },
        { status: 400 }
      );
    }

    // Verify email
    const paystackEmail = String(
      transaction.customer?.email || ""
    )
      .trim()
      .toLowerCase();

    const paymentEmail = String(payment.email)
      .trim()
      .toLowerCase();

    if (paystackEmail !== paymentEmail) {
      return NextResponse.json(
        {
          error:
            "Payment email does not match."
        },
        { status: 400 }
      );
    }

    // -----------------------------------------
    // CHECK WHETHER THIS REFERENCE WAS ALREADY
    // USED TO CREATE VOTES
    // -----------------------------------------

    const { data: existingVotes, error: existingError } =
      await db
        .from("votes")
        .select("id")
        .eq("payment_reference", reference);

    if (existingError) {
      throw existingError;
    }

    // If votes already exist, don't create them again.
    if (existingVotes && existingVotes.length > 0) {
      await db
        .from("payments")
        .update({
          status: "success",
          paid_at:
            payment.paid_at ||
            new Date().toISOString()
        })
        .eq("reference", reference);

      return NextResponse.json({
        success: true,
        message: "Payment already credited.",
        votes: existingVotes.length,
        reference
      });
    }

    // -----------------------------------------
    // GET NOMINEE CATEGORY
    // -----------------------------------------

    const { data: nominee, error: nomineeError } =
      await db
        .from("nominees")
        .select("id, category_id, is_active")
        .eq("id", payment.nominee_id)
        .maybeSingle();

    if (nomineeError) {
      throw nomineeError;
    }

    if (!nominee) {
      return NextResponse.json(
        { error: "Nominee no longer exists." },
        { status: 404 }
      );
    }

    if (!nominee.is_active) {
      return NextResponse.json(
        {
          error:
            "This nominee is no longer available."
        },
        { status: 400 }
      );
    }

    // -----------------------------------------
    // CREATE VOTES
    // -----------------------------------------

    const votes = Array.from(
      { length: payment.vote_count },
      () => ({
        nominee_id: payment.nominee_id,
        category_id: nominee.category_id,
        email: payment.email,
        payment_reference: reference
      })
    );

    const { error: voteError } =
      await db
        .from("votes")
        .insert(votes);

    if (voteError) {
      throw voteError;
    }

    // -----------------------------------------
    // MARK PAYMENT SUCCESSFUL
    // -----------------------------------------

    const { error: finalUpdateError } =
      await db
        .from("payments")
        .update({
          status: "success",
          paid_at: new Date().toISOString()
        })
        .eq("reference", reference)
        .eq("status", "pending");

    if (finalUpdateError) {
      throw finalUpdateError;
    }

    return NextResponse.json({
      success: true,
      message:
        "Payment verified and votes credited.",
      votes: payment.vote_count,
      reference
    });

  } catch (error: any) {

    console.error(
      "Payment verification error:",
      error
    );

    return NextResponse.json(
      {
        error:
          error.message ||
          "Something went wrong while verifying payment."
      },
      { status: 500 }
    );
  }
}
