import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing Supabase server environment variables."
    );
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
    const body = await req.json();

    const reference = String(
      body.reference || ""
    ).trim();

    if (!reference) {
      return NextResponse.json(
        {
          error:
            "Payment reference is required.",
        },
        { status: 400 }
      );
    }

    const db = getAdminClient();

    // =========================================
    // FIND PAYMENT
    // =========================================

    const {
      data: payment,
      error: paymentError,
    } = await db
      .from("payments")
      .select(
        "id, reference, email, nominee_id, amount_kobo, vote_count, status, paid_at"
      )
      .eq("reference", reference)
      .maybeSingle();

    if (paymentError) {
      console.error(
        "Payment lookup error:",
        paymentError
      );

      return NextResponse.json(
        {
          error:
            `Payment lookup failed: ${paymentError.message}`,
        },
        { status: 500 }
      );
    }

    if (!payment) {
      return NextResponse.json(
        {
          error:
            "Payment record not found.",
        },
        { status: 404 }
      );
    }

    // =========================================
    // PREVENT DUPLICATE PROCESSING
    // =========================================

    if (payment.status === "success") {
      return NextResponse.json({
        success: true,
        alreadyProcessed: true,
        votes:
          Number(payment.vote_count) || 0,
        message:
          "Payment has already been processed.",
      });
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
      console.error(
        "Nominee lookup error:",
        nomineeError
      );

      return NextResponse.json(
        {
          error:
            `Unable to verify nominee: ${nomineeError.message}`,
        },
        { status: 500 }
      );
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

    if (!nominee.is_active) {
      return NextResponse.json(
        {
          error:
            "This nominee is no longer active.",
        },
        { status: 400 }
      );
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

        cache: "no-store",
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
            "Unable to verify payment with Paystack.",
        },
        { status: 400 }
      );
    }

    const transaction =
      paystackData.data;

    // =========================================
    // PAYMENT MUST BE SUCCESSFUL
    // =========================================

    if (
      transaction.status !== "success"
    ) {
      await db
        .from("payments")
        .update({
          status:
            transaction.status ||
            "failed",
        })
        .eq(
          "reference",
          reference
        );

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
    // VERIFY PAYMENT REFERENCE
    // =========================================

    if (
      transaction.reference !==
      reference
    ) {
      return NextResponse.json(
        {
          error:
            "Payment reference mismatch.",
        },
        { status: 400 }
      );
    }

    // =========================================
    // VERIFY AMOUNT
    // =========================================

    const expectedAmount =
      Number(payment.amount_kobo);

    const actualAmount =
      Number(transaction.amount);

    if (
      !Number.isInteger(
        expectedAmount
      ) ||
      expectedAmount < 1
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid stored payment amount.",
        },
        { status: 500 }
      );
    }

    if (
      actualAmount !==
      expectedAmount
    ) {
      await db
        .from("payments")
        .update({
          status:
            "amount_mismatch",
        })
        .eq(
          "reference",
          reference
        );

      return NextResponse.json(
        {
          error:
            "Payment amount does not match the expected amount.",
        },
        { status: 400 }
      );
    }

    // =========================================
    // VERIFY EMAIL
    // =========================================

    if (
      transaction.customer?.email &&
      transaction.customer.email
        .toLowerCase() !==
        payment.email.toLowerCase()
    ) {
      return NextResponse.json(
        {
          error:
            "Payment email does not match the voting email.",
        },
        { status: 400 }
      );
    }

    // =========================================
    // VALIDATE VOTE COUNT
    // =========================================

    const votesToAdd =
      Number(payment.vote_count);

    if (
      !Number.isInteger(
        votesToAdd
      ) ||
      votesToAdd < 1 ||
      votesToAdd > 1000
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid vote quantity stored for this payment.",
        },
        { status: 500 }
      );
    }

    // =========================================
    // CHECK IF THIS PAYMENT REFERENCE
    // ALREADY CREATED VOTES
    // =========================================

    const {
      data: existingVotes,
      error: existingVotesError,
    } = await db
      .from("votes")
      .select("id")
      .eq(
        "payment_reference",
        reference
      )
      .limit(1);

    if (existingVotesError) {
      console.error(
        "Existing vote check error:",
        existingVotesError
      );

      return NextResponse.json(
        {
          error:
            `Unable to check existing votes: ${existingVotesError.message}`,
        },
        { status: 500 }
      );
    }

    if (
      existingVotes &&
      existingVotes.length > 0
    ) {
      await db
        .from("payments")
        .update({
          status: "success",
          paid_at:
            payment.paid_at ||
            new Date().toISOString(),
        })
        .eq(
          "reference",
          reference
        );

      return NextResponse.json({
        success: true,
        alreadyProcessed: true,
        votes: votesToAdd,
        message:
          "Votes for this payment have already been recorded.",
      });
    }

    // =========================================
    // CREATE VOTES
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
          reference,
      })
    );

    const {
      error: voteError,
    } = await db
      .from("votes")
      .insert(voteRows);

    if (voteError) {
      console.error(
        "Vote insertion error:",
        voteError
      );

      return NextResponse.json(
        {
          error:
            `Vote database error: ${voteError.message}`,
          code:
            voteError.code,
          details:
            voteError.details,
          hint:
            voteError.hint,
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
        paid_at:
          new Date().toISOString(),
      })
      .eq(
        "reference",
        reference
      );

    if (updateError) {
      console.error(
        "Payment update error:",
        updateError
      );

      return NextResponse.json(
        {
          error:
            `Payment was verified and votes were created, but payment status could not be updated: ${updateError.message}`,
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
      "Payment verification error:",
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
