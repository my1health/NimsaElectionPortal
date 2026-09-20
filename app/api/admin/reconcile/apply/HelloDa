import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  recordPaidTransaction,
  verifyPaystackTransaction,
} from "@/lib/paystack";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const requestedReferences = Array.isArray(
      body?.references
    )
      ? body.references
          .map((r: any) => String(r).trim())
          .filter(Boolean)
      : [];

    const references = [
      ...new Set<string>(requestedReferences),
    ];

    if (references.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "No transaction references were supplied.",
        },
        { status: 400 }
      );
    }

    const db = supabaseAdmin();

    const result = {
      requested: references.length,

      recorded: 0,

      statusesUpdated: 0,

      votesAdded: 0,

      alreadyCorrect: 0,

      skipped: 0,

      failed: 0,

      details: [] as any[],
    };

    // ==========================================================
    // PROCESS EACH REFERENCE
    //
    // Every reference is re-verified with Paystack. Votes are only
    // ever added, never deleted, and never beyond what was paid for.
    // ==========================================================

    for (const reference of references) {
      try {
        const transaction =
          await verifyPaystackTransaction(reference);

        const outcome = await recordPaidTransaction(
          db,
          transaction
        );

        if (outcome.outcome !== "recorded") {
          result.skipped++;

          result.details.push({
            reference,
            action: outcome.outcome,
            message: outcome.message,
          });

          continue;
        }

        if (outcome.statusUpdated) {
          result.statusesUpdated++;
        }

        if (outcome.votesAdded === 0) {
          result.alreadyCorrect++;

          result.details.push({
            reference,
            action: "already_correct",
            message: outcome.statusUpdated
              ? "Payment marked as successful. Its votes were already recorded."
              : "Vote count already matches the payment. Nothing was added or deleted.",
          });

          continue;
        }

        result.recorded++;

        result.votesAdded += outcome.votesAdded;

        result.details.push({
          reference,
          action: "votes_added",
          votesAdded: outcome.votesAdded,
          message: `Added ${outcome.votesAdded} missing vote(s). No existing votes were deleted.`,
        });
      } catch (error: any) {
        result.failed++;

        result.details.push({
          reference,
          action: "error",
          message:
            error?.message ||
            "Unknown error occurred.",
        });

        console.error(
          `RECONCILIATION ERROR ${reference}:`,
          error
        );
      }
    }

    // ==========================================================
    // FINAL RESPONSE
    // ==========================================================

    return NextResponse.json({
      success: result.failed === 0,

      message:
        result.failed === 0
          ? "Paystack reconciliation completed successfully."
          : "Reconciliation completed with some errors.",

      result,
    });
  } catch (error: any) {
    console.error(
      "RECONCILIATION APPLY ERROR:",
      error
    );

    return NextResponse.json(
      {
        success: false,

        error:
          error?.message ||
          "Failed to apply reconciliation.",
      },
      { status: 500 }
    );
  }
}
