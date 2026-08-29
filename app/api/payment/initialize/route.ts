import { NextResponse } from "next/server";

const VOTE_PRICE_NAIRA = 100;

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const email = String(body.email || "").trim().toLowerCase();
    const nomineeId = String(body.nomineeId || "").trim();
    const amountNaira = Number(body.amount);

    // Basic validation
    if (!email) {
      return NextResponse.json(
        { error: "Email is required." },
        { status: 400 }
      );
    }

    if (!nomineeId) {
      return NextResponse.json(
        { error: "Nominee is required." },
        { status: 400 }
      );
    }

    if (!Number.isFinite(amountNaira)) {
      return NextResponse.json(
        { error: "Invalid payment amount." },
        { status: 400 }
      );
    }

    // Amount must be at least ₦100
    if (amountNaira < VOTE_PRICE_NAIRA) {
      return NextResponse.json(
        { error: "Minimum payment is ₦100." },
        { status: 400 }
      );
    }

    // Amount must be a multiple of ₦100
    if (amountNaira % VOTE_PRICE_NAIRA !== 0) {
      return NextResponse.json(
        {
          error:
            "Payment amount must be a multiple of ₦100."
        },
        { status: 400 }
      );
    }

    // Calculate votes on the SERVER
    const voteCount =
      amountNaira / VOTE_PRICE_NAIRA;

    // Convert naira to kobo
    const amountKobo =
      amountNaira * 100;

    const secretKey =
      process.env.PAYSTACK_SECRET_KEY;

    if (!secretKey) {
      return NextResponse.json(
        {
          error:
            "Paystack secret key is not configured."
        },
        { status: 500 }
      );
    }

    // Initialize Paystack transaction
    const response = await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email,
          amount: amountKobo,

          metadata: {
            nominee_id: nomineeId,
            vote_count: voteCount,
            amount_naira: amountNaira
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok || !data.status) {
      return NextResponse.json(
        {
          error:
            data.message ||
            "Unable to initialize Paystack payment."
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      authorization_url:
        data.data.authorization_url,
      access_code:
        data.data.access_code,
      reference:
        data.data.reference,
      amount_naira:
        amountNaira,
      vote_count:
        voteCount
    });

  } catch (error: any) {

    console.error(
      "Paystack initialization error:",
      error
    );

    return NextResponse.json(
      {
        error:
          error.message ||
          "Something went wrong."
      },
      { status: 500 }
    );
  }
}
