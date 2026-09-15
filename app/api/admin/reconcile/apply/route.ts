import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY!;

function metadataValue(metadata: any, keys: string[]) {
  if (!metadata || typeof metadata !== "object") return null;

  for (const key of keys) {
    if (
      metadata[key] !== undefined &&
      metadata[key] !== null &&
      metadata[key] !== ""
    ) {
      return metadata[key];
    }
  }

  return null;
}

function toNumber(value: any): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const n = Number(value);

  return Number.isFinite(n) ? n : null;
}

function toStringValue(value: any): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  return String(value);
}

async function verifyPaystack(reference: string) {
  const response = await fetch(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(
      reference
    )}`,
    {
      method: "GET",

      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },

      cache: "no-store",
    }
  );

  const text = await response.text();

  let result: any;

  try {
    result = JSON.parse(text);
  } catch {
    throw new Error(
      `Paystack returned an invalid response for ${reference}.`
    );
  }

  if (!response.ok || !result.status) {
    throw new Error(
      result?.message ||
        `Could not verify ${reference} with Paystack.`
    );
  }

  return result.data;
}

async function findPayment(reference: string) {
  // IMPORTANT:
  // The payments table uses "reference".
  // payment_reference belongs to the votes table.

  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .eq("reference", reference)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Could not find payment ${reference}: ${error.message}`
    );
  }

  return data;
}

async function getVotes(reference: string) {
  const { data, error } = await supabase
    .from("votes")
    .select(
      "id, nominee_id, category_id, email, payment_reference"
    )
    .eq("payment_reference", reference);

  if (error) {
    throw new Error(
      `Could not load votes for ${reference}: ${error.message}`
    );
  }

  return data || [];
}

async function nomineeExists(nomineeId: string) {
  const { data, error } = await supabase
    .from("nominees")
    .select("id")
    .eq("id", nomineeId)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Could not verify nominee: ${error.message}`
    );
  }

  return !!data;
}

export async function POST(request: NextRequest) {
  try {
    if (!PAYSTACK_SECRET_KEY) {
      return NextResponse.json(
        {
          success: false,
          error: "PAYSTACK_SECRET_KEY is missing.",
        },
        { status: 500 }
      );
    }

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

    const result = {
      requested: references.length,

      paymentsCreated: 0,

      statusesUpdated: 0,

      votesAdded: 0,

      alreadyCorrect: 0,

      skipped: 0,

      failed: 0,

      details: [] as any[],
    };

    // ==========================================================
    // PROCESS EACH REFERENCE
    // ==========================================================

    for (const reference of references) {
      try {
        // ------------------------------------------------------
        // ALWAYS VERIFY DIRECTLY WITH PAYSTACK
        // ------------------------------------------------------

        const transaction =
          await verifyPaystack(reference);

        // ------------------------------------------------------
        // ONLY PAYSTACK SUCCESS IS ELIGIBLE
        // ------------------------------------------------------

        if (
          !transaction ||
          String(transaction.status).toLowerCase() !==
            "success"
        ) {
          result.skipped++;

          result.details.push({
            reference,

            action: "untouched",

            message:
              "Paystack does not confirm this transaction as SUCCESS. Nothing was changed.",
          });

          continue;
        }

        const paystackAmountKobo = Number(
          transaction.amount || 0
        );

        const metadata = transaction.metadata || {};

        const nomineeId = toStringValue(
          metadataValue(metadata, [
            "nominee_id",
            "nomineeId",
            "nomineeID",
          ])
        );

        const categoryId = toStringValue(
          metadataValue(metadata, [
            "category_id",
            "categoryId",
            "categoryID",
          ])
        );

        const paystackVoteCount = toNumber(
          metadataValue(metadata, [
            "vote_count",
            "voteCount",
            "votes",
            "quantity",
          ])
        );

        const email =
          toStringValue(
            metadataValue(metadata, [
              "email",
              "customer_email",
            ])
          ) ||
          toStringValue(
            transaction.customer?.email
          );

        // ------------------------------------------------------
        // REQUIRED VOTING DATA
        // ------------------------------------------------------

        if (
          !nomineeId ||
          !categoryId ||
          paystackVoteCount === null
        ) {
          result.skipped++;

          result.details.push({
            reference,

            action: "manual_review",

            message:
              "Paystack SUCCESS confirmed, but nominee_id, category_id or vote_count is missing. No votes were changed.",
          });

          continue;
        }

        // ------------------------------------------------------
        // VERIFY NOMINEE
        // ------------------------------------------------------

        if (!(await nomineeExists(nomineeId))) {
          result.skipped++;

          result.details.push({
            reference,

            action: "manual_review",

            message:
              "The nominee specified by Paystack does not exist in Supabase. Nothing was changed.",
          });

          continue;
        }

        // ------------------------------------------------------
        // FIND PAYMENT
        // ------------------------------------------------------

        let payment =
          await findPayment(reference);

        // ======================================================
        // CASE A: PAYMENT DOES NOT EXIST
        // ======================================================

        if (!payment) {
          const { data: createdPayment, error } =
            await supabase
              .from("payments")
              .insert({
                reference,

                email,

                nominee_id: nomineeId,

                category_id: categoryId,

                amount_kobo: paystackAmountKobo,

                vote_count: paystackVoteCount,

                status: "success",

                paid_at:
                  transaction.paid_at ||
                  transaction.transaction_date ||
                  new Date().toISOString(),
              })
              .select("*")
              .single();

          if (error) {
            throw new Error(
              `Could not create payment: ${error.message}`
            );
          }

          payment = createdPayment;

          result.paymentsCreated++;

          result.statusesUpdated++;
        }

        // ======================================================
        // CASE B: PAYMENT ALREADY EXISTS
        // ======================================================

        else {
          const currentStatus = String(
            payment.status || ""
          ).toLowerCase();

          // ----------------------------------------------------
          // PAYSTACK SUCCESS ALWAYS OVERRIDES SUPABASE STATUS
          // ----------------------------------------------------

          if (currentStatus !== "success") {
            const { error } = await supabase
              .from("payments")
              .update({
                status: "success",

                paid_at:
                  transaction.paid_at ||
                  transaction.transaction_date ||
                  payment.paid_at ||
                  new Date().toISOString(),
              })
              .eq("id", payment.id);

            if (error) {
              throw new Error(
                `Could not change payment ${reference} to SUCCESS: ${error.message}`
              );
            }

            result.statusesUpdated++;

            payment.status = "success";
          }
        }

        // ======================================================
        // CHECK AMOUNT
        //
        // STATUS HAS ALREADY BEEN SYNCHRONIZED.
        //
        // IF AMOUNT IS WRONG:
        // - leave status = success
        // - DO NOT ADD VOTES
        // - DO NOT DELETE VOTES
        // ======================================================

        const supabaseAmountKobo = Number(
          payment.amount_kobo || 0
        );

        if (
          supabaseAmountKobo !==
          paystackAmountKobo
        ) {
          result.skipped++;

          result.details.push({
            reference,

            action: "amount_mismatch",

            paystackAmountKobo,

            supabaseAmountKobo,

            message:
              "Paystack SUCCESS was synchronized to Supabase SUCCESS, but the payment amounts differ. Votes were left untouched for manual review.",
          });

          continue;
        }

        // ======================================================
        // GET ALL EXISTING VOTES
        // ======================================================

        const existingVotes =
          await getVotes(reference);

        const actualVoteCount =
          existingVotes.length;

        // ======================================================
        // EXTRA VOTES
        //
        // NEVER DELETE.
        // NEVER REDUCE.
        // NEVER MODIFY.
        // ======================================================

        if (
          actualVoteCount >
          paystackVoteCount
        ) {
          result.skipped++;

          result.details.push({
            reference,

            action: "extra_votes_left_untouched",

            paystackVoteCount,

            supabaseVoteCount:
              actualVoteCount,

            message:
              "Supabase has more votes than Paystack. ALL EXISTING VOTES WERE LEFT UNTOUCHED. No votes were deleted.",
          });

          continue;
        }

        // ======================================================
        // EXACT MATCH
        // ======================================================

        if (
          actualVoteCount ===
          paystackVoteCount
        ) {
          result.alreadyCorrect++;

          result.details.push({
            reference,

            action: "already_correct",

            paystackVoteCount,

            supabaseVoteCount:
              actualVoteCount,

            message:
              "Vote count already matches Paystack. Nothing was added or deleted.",
          });

          continue;
        }

        // ======================================================
        // MISSING VOTES
        //
        // ONLY ADD THE DIFFERENCE.
        // ======================================================

        const missingVotes =
          paystackVoteCount -
          actualVoteCount;

        const voteRows = Array.from(
          { length: missingVotes },
          () => ({
            nominee_id: nomineeId,

            category_id: categoryId,

            email,

            payment_reference: reference,
          })
        );

        const { error: voteError } =
          await supabase
            .from("votes")
            .insert(voteRows);

        if (voteError) {
          throw new Error(
            `Could not add missing votes: ${voteError.message}`
          );
        }

        result.votesAdded += missingVotes;

        result.details.push({
          reference,

          action: "votes_added",

          paystackVoteCount,

          previousSupabaseVoteCount:
            actualVoteCount,

          votesAdded: missingVotes,

          message:
            `Added exactly ${missingVotes} missing vote(s). No existing votes were deleted.`,
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
