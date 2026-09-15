import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const VOTE_PRICE_NAIRA = 100;
const VOTE_PRICE_KOBO = VOTE_PRICE_NAIRA * 100;

export async function POST(request: Request) {
  try {
    const body = await request.json();

    console.log("PAYMENT REQUEST BODY:", body);

    const email = String(body.email || "")
      .trim()
      .toLowerCase();

    const nomineeId = String(body.nomineeId || "").trim();

    let quantity = Number(body.quantity);

    // Backward compatibility with old frontend
    if (
      !Number.isInteger(quantity) ||
      quantity < 1
    ) {
      const oldAmount = Number(body.amount);

      if (
        Number.isFinite(oldAmount) &&
        oldAmount >= VOTE_PRICE_NAIRA &&
        oldAmount % VOTE_PRICE_NAIRA === 0
      ) {
        quantity = oldAmount / VOTE_PRICE_NAIRA;
      }
    }

    // =========================================
    // VALIDATION
    // =========================================

    if (!email) {
      return NextResponse.json(
        { error: "Email is required." },
        { status: 400 }
      );
    }

    if (!email.includes("@")) {
      return NextResponse.json(
        { error: "Please enter a valid email." },
        { status: 400 }
      );
    }

    if (!nomineeId) {
      return NextResponse.json(
        { error: "Nominee is required." },
        { status: 400 }
      );
    }

    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 1000
    ) {
      return NextResponse.json(
        {
          error:
            "Please select between 1 and 1000 votes.",
          receivedQuantity: body.quantity,
          receivedAmount: body.amount,
        },
        { status: 400 }
      );
    }

    // =========================================
    // CALCULATE AMOUNT ON SERVER
    // =========================================

    const amountNaira =
      quantity * VOTE_PRICE_NAIRA;

    const amountKobo =
      quantity * VOTE_PRICE_KOBO;

    // =========================================
    // SUPABASE ADMIN
    // =========================================

    const db = supabaseAdmin();

    // =========================================
    // VERIFY NOMINEE
    // =========================================

    const {
      data: nominee,
      error: nomineeError,
    } = await db
      .from("nominees")
      .select(
        "id, name, category_id, is_active"
      )
      .eq("id", nomineeId)
      .maybeSingle();

    if (nomineeError) {
      console.error(
        "Nominee lookup error:",
        nomineeError
      );

      return NextResponse.json(
        {
          error: "Unable to verify nominee.",
          details: nomineeError.message,
        },
        { status: 500 }
      );
    }

    if (!nominee) {
      return NextResponse.json(
        {
          error: "Nominee not found.",
        },
        { status: 404 }
      );
    }

    if (!nominee.is_active) {
      return NextResponse.json(
        {
          error:
            "This nominee is no longer available.",
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
    // PAYSTACK INITIALIZATION
    // =========================================

    const paystackResponse = await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",

        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          email,

          amount: amountKobo,

          callback_url:
            "https://nimsa-election.vercel.app/payment/callback",

          metadata: {
            nominee_id: nominee.id,
            nominee_name: nominee.name,
            category_id: nominee.category_id,

            vote_count: quantity,

            amount_naira: amountNaira,

            amount_kobo: amountKobo,

            vote_price_naira:
              VOTE_PRICE_NAIRA,

            system: "voting",
          },
        }),
      }
    );

    const paystackData =
      await paystackResponse.json();

    console.log(
      "PAYSTACK INITIALIZATION:",
      paystackData
    );

    if (
      !paystackResponse.ok ||
      !paystackData.status ||
      !paystackData.data
    ) {
      return NextResponse.json(
        {
          error:
            paystackData.message ||
            "Unable to initialize Paystack payment.",
        },
        { status: 400 }
      );
    }

    const reference =
      paystackData.data.reference;

    if (!reference) {
      return NextResponse.json(
        {
          error:
            "Paystack did not return a payment reference.",
        },
        { status: 500 }
      );
    }

    // =========================================
    // SAVE PENDING PAYMENT
    // =========================================

    const {
      error: paymentError,
    } = await db
      .from("payments")
      .insert({
        reference,

        email,

        nominee_id: nominee.id,

        amount_kobo: amountKobo,

        vote_count: quantity,

        status: "pending",
      });

    if (paymentError) {
      console.error(
        "PAYMENT DATABASE ERROR:",
        paymentError
      );

      return NextResponse.json(
        {
          error:
            `Payment database error: ${paymentError.message}`,

          code: paymentError.code,

          details: paymentError.details,

          hint: paymentError.hint,
        },
        { status: 500 }
      );
    }

    // =========================================
    // SUCCESS
    // =========================================

    return NextResponse.json({
      success: true,

      authorization_url:
        paystackData.data.authorization_url,

      access_code:
        paystackData.data.access_code,

      reference,

      amount_naira: amountNaira,

      amount_kobo: amountKobo,

      vote_count: quantity,

      nominee: {
        id: nominee.id,
        name: nominee.name,
      },
    });
  } catch (error: any) {
    console.error(
      "PAYMENT INITIALIZATION ERROR:",
      error
    );

    return NextResponse.json(
      {
        error:
          error?.message ||
          "Something went wrong while starting payment.",
      },
      { status: 500 }
    );
  }
}
