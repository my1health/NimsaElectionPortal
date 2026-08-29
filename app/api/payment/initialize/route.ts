import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const VOTE_PRICE_NAIRA = 100;

export async function POST(request: Request) {
  try {
    // =========================================
    // READ REQUEST
    // =========================================

    const body = await request.json();

    const email = String(body.email || "")
      .trim()
      .toLowerCase();

    const nomineeId = String(body.nomineeId || "").trim();

    const quantity = Number(body.quantity);

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
            "Please select between 1 and 1000 votes."
        },
        { status: 400 }
      );
    }

    // =========================================
    // CALCULATE PAYMENT SERVER-SIDE
    // =========================================

    const amountNaira =
      quantity * VOTE_PRICE_NAIRA;

    const amountKobo =
      amountNaira * 100;

    // =========================================
    // SUPABASE ADMIN CLIENT
    // =========================================

    const db = supabaseAdmin();

    // =========================================
    // CHECK NOMINEE
    // =========================================

    const {
      data: nominee,
      error: nomineeError
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
          error:
            "Unable to verify nominee.",
          details: nomineeError.message
        },
        { status: 500 }
      );
    }

    if (!nominee) {
      return NextResponse.json(
        {
          error: "Nominee not found."
        },
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

    // =========================================
    // PAYSTACK SECRET KEY
    // =========================================

    const secretKey =
      process.env.PAYSTACK_SECRET_KEY;

    if (!secretKey) {
      console.error(
        "PAYSTACK_SECRET_KEY is missing."
      );

      return NextResponse.json(
        {
          error:
            "Paystack secret key is not configured."
        },
        { status: 500 }
      );
    }

    // =========================================
    // INITIALIZE PAYSTACK
    // =========================================

    const paystackResponse = await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",

        headers: {
          Authorization:
            `Bearer ${secretKey}`,
          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          email,
          amount: amountKobo,

          metadata: {
            nominee_id: nominee.id,
            nominee_name: nominee.name,
            category_id: nominee.category_id,
            vote_count: quantity,
            amount_naira: amountNaira
          }
        })
      }
    );

    const paystackData =
      await paystackResponse.json();

    // =========================================
    // CHECK PAYSTACK RESPONSE
    // =========================================

    if (
      !paystackResponse.ok ||
      !paystackData.status
    ) {
      console.error(
        "Paystack initialization error:",
        paystackData
      );

      return NextResponse.json(
        {
          error:
            paystackData.message ||
            "Unable to initialize Paystack payment."
        },
        { status: 400 }
      );
    }

    const reference =
      paystackData.data.reference;

    const authorizationUrl =
      paystackData.data.authorization_url;

    // =========================================
    // SAVE PENDING PAYMENT
    // =========================================

    const {
      error: paymentError
    } = await db
      .from("payments")
      .insert({
        reference: reference,
        email: email,
        nominee_id: nominee.id,
        amount_kobo: amountKobo,
        vote_count: quantity,
        status: "pending"
      });

    if (paymentError) {
      console.error(
        "Payment database error:",
        paymentError
      );

      return NextResponse.json(
        {
          error:
            `Payment database error: ${paymentError.message}`,
          code: paymentError.code,
          details: paymentError.details,
          hint: paymentError.hint
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
        authorizationUrl,

      access_code:
        paystackData.data.access_code,

      reference:

        reference,

      amount_naira:
        amountNaira,

      amount_kobo:
        amountKobo,

      vote_count:
        quantity,

      nominee: {
        id: nominee.id,
        name: nominee.name
      }
    });

  } catch (error: any) {

    console.error(
      "Payment initialization error:",
      error
    );

    return NextResponse.json(
      {
        error:
          error?.message ||
          "Something went wrong while starting payment."
      },
      { status: 500 }
    );
  }
}
