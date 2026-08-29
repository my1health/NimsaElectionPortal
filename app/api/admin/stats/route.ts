import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET() {
  try {
    const db = supabaseAdmin();

    // -----------------------------
    // CATEGORIES
    // -----------------------------
    const { count: categoryCount, error: categoryError } =
      await db
        .from("categories")
        .select("*", {
          count: "exact",
          head: true,
        });

    if (categoryError) {
      throw categoryError;
    }

    // -----------------------------
    // NOMINEES
    // -----------------------------
    const { count: nomineeCount, error: nomineeError } =
      await db
        .from("nominees")
        .select("*", {
          count: "exact",
          head: true,
        });

    if (nomineeError) {
      throw nomineeError;
    }

    // -----------------------------
    // ACTIVE NOMINEES
    // -----------------------------
    const {
      count: activeNomineeCount,
      error: activeNomineeError,
    } = await db
      .from("nominees")
      .select("*", {
        count: "exact",
        head: true,
      })
      .eq("is_active", true);

    if (activeNomineeError) {
      throw activeNomineeError;
    }

    // -----------------------------
    // TOTAL VOTES
    // -----------------------------
    const { count: voteCount, error: voteError } =
      await db
        .from("votes")
        .select("*", {
          count: "exact",
          head: true,
        });

    if (voteError) {
      throw voteError;
    }

    // -----------------------------
    // SUCCESSFUL PAYMENTS
    // -----------------------------
    const {
      count: successfulPaymentCount,
      error: successfulPaymentError,
    } = await db
      .from("payments")
      .select("*", {
        count: "exact",
        head: true,
      })
      .eq("status", "success");

    if (successfulPaymentError) {
      throw successfulPaymentError;
    }

    // -----------------------------
    // PENDING PAYMENTS
    // -----------------------------
    const {
      count: pendingPaymentCount,
      error: pendingPaymentError,
    } = await db
      .from("payments")
      .select("*", {
        count: "exact",
        head: true,
      })
      .eq("status", "pending");

    if (pendingPaymentError) {
      throw pendingPaymentError;
    }

    // -----------------------------
    // FAILED PAYMENTS
    // -----------------------------
    const {
      count: failedPaymentCount,
      error: failedPaymentError,
    } = await db
      .from("payments")
      .select("*", {
        count: "exact",
        head: true,
      })
      .neq("status", "success")
      .neq("status", "pending");

    if (failedPaymentError) {
      throw failedPaymentError;
    }

    // -----------------------------
    // TOTAL MONEY COLLECTED
    // -----------------------------
    const {
      data: successfulPayments,
      error: amountError,
    } = await db
      .from("payments")
      .select("amount_kobo")
      .eq("status", "success");

    if (amountError) {
      throw amountError;
    }

    const totalAmountKobo =
      (successfulPayments || []).reduce(
        (total, payment) =>
          total + Number(payment.amount_kobo || 0),
        0
      );

    const totalAmountNaira =
      totalAmountKobo / 100;

    // -----------------------------
    // RESPONSE
    // -----------------------------
    return NextResponse.json({
      success: true,

      statistics: {
        categories: categoryCount || 0,

        nominees: nomineeCount || 0,

        activeNominees:
          activeNomineeCount || 0,

        votes: voteCount || 0,

        successfulPayments:
          successfulPaymentCount || 0,

        pendingPayments:
          pendingPaymentCount || 0,

        failedPayments:
          failedPaymentCount || 0,

        totalAmountKobo,

        totalAmountNaira,
      },
    });

  } catch (error: any) {
    console.error(
      "Admin statistics error:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error?.message ||
          "Unable to load admin statistics.",
      },
      {
        status: 500,
      }
    );
  }
}
