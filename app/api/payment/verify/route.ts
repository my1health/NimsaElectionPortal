import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: Request) {
  try {
    const { reference } = await req.json();

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
    // FIND PAYMENT
    // =========================================

    const {
      data: payment,
      error: paymentError,
    } = await db
      .from("payments")
      .select(
        "id, reference, email, nominee_id, amount_kobo, vote_count, status"
      )
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
            `Payment lookup error: ${paymentError.message}`,
          code: paymentError.code,
          details: paymentError.details,
        },
        { status: 500 }
      );
    }

    if (!payment) {
      return NextResponse.json(
        {
          error: "Payment record not found.",
        },
        { status: 404 }
      );
    }

    // =========================================
    // PREVENT DOUBLE PROCESSING
    // =========================================

    if (payment.status === "success") {
      return NextResponse.json({
        success: true,
        alreadyProcessed: true,
        votes: payment.vote_count,
        message:
          "Payment has already been processed.",
      });
    }

    // =========================================
    // PAYSTACK SECRET KEY
    // =========================================

    const secretKey =
      process.env.PAYSTACK_SECRET_KEY;

    if (!secretKey) {
      return NextResponse.json(
        {
          error:
            "Paystack secret key is not configured.",
        },
        { status: 500 }
      );
    }

    // =========================================
    // VERIFY WITH PAYSTACK
    // =========================================

    const response = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(
        reference
      )}`,
      {
        method: "GET",

        headers: {
          Authorization:
            `Bearer ${secretKey}`,
          "Content-Type":
            "application/json",
        },
      }
    );

    const paystackData =
      await response.json();

    console.log(
      "PAYSTACK VERIFY RESPONSE:",
      paystackData
    );

    if (
      !response.ok ||
      !paystackData.status
    ) {
      return NextResponse.json(
        {
          error:
            paystackData.message ||
            "Unable to verify payment.",
        },
        { status: 400 }
      );
    }

    const transaction =
      paystackData.data;

    // =========================================
    // CHECK PAYMENT STATUS
    // =========================================

    if (transaction.status !== "success") {
      await db
        .from("payments")
        .update({
          status:
            transaction.status ||
            "failed",
        })
        .eq("id", payment.id);

      return NextResponse.json(
        {
          error:
            "Payment was not successful.",
          status:
            transaction.status,
        },
        { status: 400 }
      );
    }

    // =========================================
    // CHECK PAYMENT AMOUNT
    // =========================================

    if (
      Number(transaction.amount) !==
      Number(payment.amount_kobo)
    ) {
      await db
        .from("payments")
        .update({
          status: "amount_mismatch",
        })
        .eq("id", payment.id);

      return NextResponse.json(
        {
          error:
            "Payment amount does not match the expected amount.",
        },
        { status: 400 }
      );
    }

    // =========================================
    // GET NOMINEE + CATEGORY
    // =========================================

    const {
      data: nominee,
      error: nomineeError,
    } = await db
      .from("nominees")
      .select(
        "id, name, category_id, is_active"
      )
      .eq("id", payment.nominee_id)
      .maybeSingle();

    if (nomineeError) {
      throw nomineeError;
    }

    if (!nominee) {
      return NextResponse.json(
        {
          error:
            "Nominee associated with this payment was not found.",
        },
        { status: 404 }
      );
    }

    // =========================================
    // VALIDATE VOTE COUNT
    // =========================================

    const votesToAdd =
      Number(payment.vote_count);

    if (
      !Number.isInteger(votesToAdd) ||
      votesToAdd < 1
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid vote quantity in payment record.",
        },
        { status: 400 }
      );
    }

    // =========================================
    // CREATE VOTE ROWS
    // =========================================

    const voteRows = Array.from(
      { length: votesToAdd },
      () => ({
        nominee_id:
          payment.nominee_id,

        category_id:
          nominee.category_id,

        email:
          payment.email,

        payment_reference:
          payment.reference,
      })
    );

    const {
      error: voteError,
    } = await db
      .from("votes")
      .insert(voteRows);

    if (voteError) {
      console.error(
        "VOTE INSERT ERROR:",
        voteError
      );

      return NextResponse.json(
        {
          error:
            `Vote database error: ${voteError.message}`,
          code: voteError.code,
          details: voteError.details,
          hint: voteError.hint,
        },
        { status: 500 }
      );
    }

    // =========================================
    // MARK PAYMENT AS SUCCESS
    // =========================================

    const {
      error: updateError,
    } = await db
      .from("payments")
      .update({
        status: "success",
        paid_at: new Date().toISOString(),
      })
      .eq("id", payment.id);

    if (updateError) {
      console.error(
        "PAYMENT UPDATE ERROR:",
        updateError
      );

      return NextResponse.json(
        {
          error:
            `Payment update error: ${updateError.message}`,
        },
        { status: 500 }
      );
    }

    // =========================================
    // SUCCESS
    // =========================================

    return NextResponse.json({
      success: true,

      votes: votesToAdd,

      nominee: {
        id: nominee.id,
        name: nominee.name,
      },

      message:
        `${votesToAdd} vote${
          votesToAdd === 1
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
