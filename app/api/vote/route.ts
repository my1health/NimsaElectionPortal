import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const VOTE_PRICE = 100; // ₦100 per vote

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
    const body = await req.json();

    const nomineeId = body.nomineeId;
    const email = String(body.email || "")
      .trim()
      .toLowerCase();
    const quantity = Number(body.quantity);

    if (!nomineeId) {
      return NextResponse.json(
        { error: "Nominee is required." },
        { status: 400 }
      );
    }

    if (!email || !email.includes("@")) {
      return NextResponse.json(
        { error: "A valid email is required." },
        { status: 400 }
      );
    }

    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 1000
    ) {
      return NextResponse.json(
        { error: "Vote quantity must be between 1 and 1000." },
        { status: 400 }
      );
    }

    const amount = quantity * VOTE_PRICE;

    const db = getAdminClient();

    // Confirm that the nominee exists and is active.
    const { data: nominee, error: nomineeError } = await db
      .from("nominees")
      .select("id, name, category_id, is_active")
      .eq("id", nomineeId)
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
        { error: "This nominee is no longer available for voting." },
        { status: 400 }
      );
    }

    // Initialize Paystack transaction.
    const paystackResponse = await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          amount: amount * 100, // Paystack uses kobo
          metadata: {
            nominee_id: nominee.id,
            category_id: nominee.category_id,
            quantity,
            vote_price: VOTE_PRICE,
          },
        }),
      }
    );

    const paystackData = await paystackResponse.json();

    if (!paystackResponse.ok || !paystackData.status) {
      return NextResponse.json(
        {
          error:
            paystackData.message ||
            "Unable to initialize payment.",
        },
        { status: 500 }
      );
    }

    const reference = paystackData.data.reference;

    // Store the payment before sending the user to Paystack.
    const { error: paymentError } = await db
      .from("payments")
      .insert({
        email,
        nominee_id: nominee.id,
        category_id: nominee.category_id,
        payment_reference: reference,
        amount: amount,
        votes: quantity,
        status: "pending",
      });

    if (paymentError) {
      throw paymentError;
    }

    return NextResponse.json({
      success: true,
      authorization_url: paystackData.data.authorization_url,
      reference,
      amount,
      quantity,
    });
  } catch (error: any) {
    console.error("Payment initialization error:", error);

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
