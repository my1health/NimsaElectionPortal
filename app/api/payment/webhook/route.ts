import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  recordPaidTransaction,
  verifyPaystackTransaction,
} from "@/lib/paystack";

export const dynamic = "force-dynamic";

// Paystack calls this for every successful charge, including when the
// voter never comes back to /payment/callback (closed the tab, lost
// connection, or paid by transfer/USSD that confirmed later).
//
// Set it in Paystack: Settings -> API Keys & Webhooks -> Webhook URL
//   https://nimsa-election.vercel.app/api/payment/webhook
export async function POST(request: Request) {
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
  // VERIFY SIGNATURE
  // The signature covers the raw body, so read it before parsing.
  // =========================================

  const rawBody = await request.text();

  const expected = Buffer.from(
    createHmac("sha512", secretKey)
      .update(rawBody)
      .digest("hex")
  );

  const received = Buffer.from(
    request.headers.get("x-paystack-signature") ||
      ""
  );

  if (
    received.length !== expected.length ||
    !timingSafeEqual(received, expected)
  ) {
    return NextResponse.json(
      { error: "Invalid signature." },
      { status: 401 }
    );
  }

  let event: any;

  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400 }
    );
  }

  if (
    event?.event !== "charge.success" ||
    !event.data?.reference
  ) {
    return NextResponse.json({
      received: true,
    });
  }

  // =========================================
  // RECORD VOTES
  // =========================================

  try {
    // Re-check with the API rather than trusting the payload.
    const transaction =
      await verifyPaystackTransaction(
        event.data.reference
      );

    const result = await recordPaidTransaction(
      supabaseAdmin(),
      transaction
    );

    if (result.outcome !== "recorded") {
      console.error(
        "PAYSTACK WEBHOOK NOT RECORDED:",
        event.data.reference,
        result
      );
    }

    return NextResponse.json({
      received: true,
      outcome: result.outcome,
    });
  } catch (error: any) {
    console.error(
      "PAYSTACK WEBHOOK ERROR:",
      error
    );

    // Anything other than 200 makes Paystack retry later.
    return NextResponse.json(
      {
        error:
          error?.message ||
          "Webhook processing failed.",
      },
      { status: 500 }
    );
  }
}
