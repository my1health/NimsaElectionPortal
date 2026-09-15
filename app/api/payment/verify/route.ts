import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  recordPaidTransaction,
  verifyPaystackTransaction,
} from "@/lib/paystack";

// Paystack statuses that can still become "success" later.
const IN_PROGRESS_STATUSES = [
  "ongoing",
  "pending",
  "processing",
  "queued",
];

export async function POST(req: Request) {
  try {
    const { reference } = await req.json();

    // =========================================
    // VALIDATE REFERENCE
    // =========================================

    if (!reference) {
      return NextResponse.json(
        {
          error: "Payment reference is required.",
        },
        { status: 400 }
      );
    }

    const db = supabaseAdmin();

    // =========================================
    // PREVENT DOUBLE PROCESSING
    // =========================================

    const {
      data: payment,
      error: paymentError,
    } = await db
      .from("payments")
      .select("vote_count, status")
      .eq("reference", reference)
      .maybeSingle();

    if (paymentError) {
      console.error(
        "PAYMENT LOOKUP ERROR:",
        paymentError
      );

      return NextResponse.json(
        {
          error:
            "Unable to find payment record.",
          details: paymentError.message,
        },
        { status: 500 }
      );
    }

    if (payment?.status === "success") {
      return NextResponse.json({
        success: true,
        alreadyProcessed: true,
        votes: Number(payment.vote_count),
        message:
          "Payment has already been processed.",
      });
    }

    // =========================================
    // VERIFY WITH PAYSTACK
    // =========================================

    let transaction;

    try {
      transaction =
        await verifyPaystackTransaction(reference);
    } catch (error: any) {
      return NextResponse.json(
        {
          error:
            error?.message ||
            "Unable to verify payment.",
        },
        { status: 400 }
      );
    }

    console.log(
      "PAYSTACK VERIFICATION:",
      transaction
    );

    const status = String(
      transaction.status || ""
    ).toLowerCase();

    if (IN_PROGRESS_STATUSES.includes(status)) {
      return NextResponse.json(
        {
          pending: true,
          status,
          message:
            "Paystack is still confirming your payment. Your votes will be added automatically once it completes, so you can safely close this page.",
        },
        { status: 202 }
      );
    }

    if (status !== "success") {
      // The webhook may already have recorded this payment,
      // so never overwrite a successful status.
      await db
        .from("payments")
        .update({
          status: status || "failed",
        })
        .eq("reference", reference)
        .neq("status", "success");

      return NextResponse.json(
        {
          error:
            "Payment was not successful.",
          status,
        },
        { status: 400 }
      );
    }

    // =========================================
    // RECORD VOTES
    // =========================================

    const result = await recordPaidTransaction(
      db,
      transaction
    );

    if (result.outcome !== "recorded") {
      return NextResponse.json(
        {
          error: `${result.message} Please contact the organisers with your payment reference.`,
        },
        {
          status:
            result.outcome === "amount_mismatch"
              ? 400
              : 422,
        }
      );
    }

    // =========================================
    // SUCCESS
    // =========================================

    return NextResponse.json({
      success: true,

      alreadyProcessed:
        result.votesAdded === 0,

      votes: result.voteCount,

      reference,

      message:
        result.votesAdded === 0
          ? "Payment has already been processed."
          : `${result.votesAdded} vote${
              result.votesAdded === 1
                ? ""
                : "s"
            } added successfully.`,
    });

  } catch (error: any) {
    console.error(
      "PAYMENT VERIFICATION ERROR:",
      error
    );

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
