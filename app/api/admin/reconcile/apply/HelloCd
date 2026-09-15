import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY!;

type PaystackTransaction = {
  reference: string;
  status: string;
  amount: number;
  paid_at?: string | null;
  transaction_date?: string | null;
  customer?: {
    email?: string | null;
  };
  metadata?: any;
};

type PaymentRow = {
  id: string;
  reference: string;
  payment_reference?: string | null;
  email?: string | null;
  nominee_id?: string | null;
  category_id?: string | null;
  amount_kobo?: number | null;
  vote_count?: number | null;
  status?: string | null;
  created_at?: string | null;
  paid_at?: string | null;
};

function getMetadataValue(metadata: any, keys: string[]) {
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

function numberValue(value: any): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const n = Number(value);

  return Number.isFinite(n) ? n : null;
}

function stringValue(value: any): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  return String(value);
}

async function verifyPaystackTransaction(
  reference: string
): Promise<PaystackTransaction> {
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
      `Paystack returned an invalid response while verifying ${reference}.`
    );
  }

  if (!response.ok || !result.status) {
    throw new Error(
      result?.message ||
        `Paystack verification failed for ${reference}.`
    );
  }

  return result.data as PaystackTransaction;
}

async function findPayment(reference: string) {
  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .or(
      `reference.eq.${reference},payment_reference.eq.${reference}`
    )
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Could not find payment ${reference}: ${error.message}`
    );
  }

  return data as PaymentRow | null;
}

async function getVoteCount(reference: string) {
  const { count, error } = await supabase
    .from("votes")
    .select("id", {
      count: "exact",
      head: true,
    })
    .eq("payment_reference", reference);

  if (error) {
    throw new Error(
      `Could not count votes for ${reference}: ${error.message}`
    );
  }

  return count || 0;
}

async function nomineeExists(nomineeId: string) {
  const { data, error } = await supabase
    .from("nominees")
    .select("id")
    .eq("id", nomineeId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Could not verify nominee ${nomineeId}: ${error.message}`
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

    if (
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.SUPABASE_SERVICE_ROLE_KEY
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Supabase environment variables are missing.",
        },
        { status: 500 }
      );
    }

    const body = await request.json();

    const requestedReferences = Array.isArray(body?.references)
      ? body.references
          .map((reference: any) => String(reference).trim())
          .filter(Boolean)
      : [];

    // Remove duplicates.
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

    // ------------------------------------------------------------
    // RESULT COUNTERS
    // ------------------------------------------------------------

    const result = {
      requested: references.length,

      corrected: 0,

      paymentsCreated: 0,

      statusesUpdated: 0,

      votesAdded: 0,

      alreadyCorrect: 0,

      skipped: 0,

      failed: 0,

      details: [] as any[],
    };

    // ------------------------------------------------------------
    // PROCESS EACH REFERENCE INDEPENDENTLY
    // ------------------------------------------------------------

    for (const reference of references) {
      try {
        // --------------------------------------------------------
        // VERIFY DIRECTLY WITH PAYSTACK
        // --------------------------------------------------------

        const transaction =
          await verifyPaystackTransaction(reference);

        // NEVER trust the frontend's claim.
        if (
          !transaction ||
          String(transaction.status).toLowerCase() !== "success"
        ) {
          result.skipped++;

          result.details.push({
            reference,
            action: "skipped",
            message:
              "Paystack does not currently confirm this transaction as successful.",
          });

          continue;
        }

        const paystackAmountKobo = Number(
          transaction.amount || 0
        );

        const metadata = transaction.metadata || {};

        const nomineeId = stringValue(
          getMetadataValue(metadata, [
            "nominee_id",
            "nomineeId",
            "nomineeID",
          ])
        );

        const categoryId = stringValue(
          getMetadataValue(metadata, [
            "category_id",
            "categoryId",
            "categoryID",
          ])
        );

        const paystackVoteCount = numberValue(
          getMetadataValue(metadata, [
            "vote_count",
            "voteCount",
            "votes",
            "quantity",
          ])
        );

        const email =
          stringValue(
            getMetadataValue(metadata, [
              "email",
              "customer_email",
            ])
          ) ||
          stringValue(transaction.customer?.email);

        // --------------------------------------------------------
        // REQUIRED METADATA
        // --------------------------------------------------------

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
              "Paystack succeeded, but nominee_id, category_id or vote_count metadata is missing. No votes were changed.",
          });

          continue;
        }

        // --------------------------------------------------------
        // VERIFY NOMINEE EXISTS
        // --------------------------------------------------------

        const nomineeIsValid =
          await nomineeExists(nomineeId);

        if (!nomineeIsValid) {
          result.skipped++;

          result.details.push({
            reference,
            action: "manual_review",
            message:
              "The nominee from Paystack metadata does not exist in Supabase. No votes were changed.",
          });

          continue;
        }

        // --------------------------------------------------------
        // FIND EXISTING PAYMENT
        // --------------------------------------------------------

        let payment = await findPayment(reference);

        // --------------------------------------------------------
        // CASE 1:
        // PAYMENT DOES NOT EXIST
        // --------------------------------------------------------

        if (!payment) {
          const { data: insertedPayment, error } =
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
              `Could not create missing payment: ${error.message}`
            );
          }

          payment = insertedPayment as PaymentRow;

          result.paymentsCreated++;
          result.statusesUpdated++;
        } else {
          // ------------------------------------------------------
          // CASE 2:
          // PAYMENT EXISTS
          // ------------------------------------------------------

          const supabaseAmountKobo = Number(
            payment.amount_kobo || 0
          );

          const amountMatches =
            supabaseAmountKobo === paystackAmountKobo;

          // ------------------------------------------------------
          // IMPORTANT:
          // PAYSTACK IS THE SOURCE OF TRUTH FOR PAYMENT STATUS.
          //
          // Even if amount differs, we can safely say:
          // Paystack says the transaction succeeded.
          //
          // BUT we DO NOT automatically create/repair votes
          // while the amount discrepancy remains.
          // ------------------------------------------------------

          const currentStatus = String(
            payment.status || ""
          ).toLowerCase();

          if (currentStatus !== "success") {
            const { error: statusError } =
              await supabase
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

            if (statusError) {
              throw new Error(
                `Could not update payment status: ${statusError.message}`
              );
            }

            result.statusesUpdated++;

            // Keep our local object synchronized.
            payment.status = "success";
          }

          // ------------------------------------------------------
          // AMOUNT MISMATCH:
          // STATUS IS UPDATED, BUT VOTES ARE NOT TOUCHED.
          // ------------------------------------------------------

          if (!amountMatches) {
            result.skipped++;

            result.details.push({
              reference,
              action: "amount_mismatch_manual_review",

              paystackAmountKobo,

              supabaseAmountKobo,

              message:
                "Paystack confirms SUCCESS and Supabase status has been synchronized to success, but the amounts differ. No votes were added or removed.",
            });

            continue;
          }

          // ------------------------------------------------------
          // UPDATE PAYMENT METADATA IF IT IS MISSING
          //
          // We don't overwrite a different nominee/category.
          // ------------------------------------------------------

          const metadataUpdate: any = {};

          if (!payment.email && email) {
            metadataUpdate.email = email;
          }

          if (!payment.nominee_id) {
            metadataUpdate.nominee_id = nomineeId;
          }

          if (!payment.category_id) {
            metadataUpdate.category_id = categoryId;
          }

          if (
            payment.vote_count === null ||
            payment.vote_count === undefined
          ) {
            metadataUpdate.vote_count =
              paystackVoteCount;
          }

          if (Object.keys(metadataUpdate).length > 0) {
            const { error: metadataError } =
              await supabase
                .from("payments")
                .update(metadataUpdate)
                .eq("id", payment.id);

            if (metadataError) {
              throw new Error(
                `Could not update payment metadata: ${metadataError.message}`
              );
            }

            Object.assign(payment, metadataUpdate);
          }
        }

        // --------------------------------------------------------
        // COUNT ACTUAL VOTES
        // --------------------------------------------------------

        const actualVoteCount =
          await getVoteCount(reference);

        // --------------------------------------------------------
        // EXTRA VOTES:
        // NEVER DELETE THEM
        // --------------------------------------------------------

        if (actualVoteCount > paystackVoteCount) {
          result.skipped++;

          result.details.push({
            reference,
            action: "extra_votes_manual_review",

            paystackVoteCount,

            supabaseVoteCount: actualVoteCount,

            message:
              "Supabase contains more vote rows than Paystack metadata. No votes were deleted.",
          });

          continue;
        }

        // --------------------------------------------------------
        // ALREADY CORRECT
        // --------------------------------------------------------

        if (actualVoteCount === paystackVoteCount) {
          result.alreadyCorrect++;

          result.details.push({
            reference,
            action: "already_correct",

            paystackVoteCount,

            supabaseVoteCount: actualVoteCount,

            message:
              "Payment is successful and the actual vote count already matches Paystack.",
          });

          continue;
        }

        // --------------------------------------------------------
        // MISSING VOTES
        // --------------------------------------------------------

        const missingVotes =
          paystackVoteCount - actualVoteCount;

        // Create exactly the missing number.
        const voteRows = Array.from(
          { length: missingVotes },
          () => ({
            nominee_id: nomineeId,
            category_id: categoryId,
            email,
            payment_reference: reference,
          })
        );

        const { error: voteInsertError } =
          await supabase
            .from("votes")
            .insert(voteRows);

        if (voteInsertError) {
          throw new Error(
            `Could not insert missing votes: ${voteInsertError.message}`
          );
        }

        result.votesAdded += missingVotes;

        result.corrected++;

        result.details.push({
          reference,
          action: "corrected",

          paystackVoteCount,

          previousSupabaseVoteCount:
            actualVoteCount,

          votesAdded: missingVotes,

          message:
            `Added exactly ${missingVotes} missing vote(s).`,
        });
      } catch (error: any) {
        result.failed++;

        result.details.push({
          reference,
          action: "failed",
          message:
            error?.message ||
            "Unknown error while processing this transaction.",
        });

        console.error(
          `RECONCILIATION APPLY ERROR [${reference}]:`,
          error
        );
      }
    }

    // ------------------------------------------------------------
    // FINAL RESPONSE
    // ------------------------------------------------------------

    return NextResponse.json({
      success: result.failed === 0,
      message:
        result.failed === 0
          ? "Reconciliation corrections completed."
          : "Reconciliation completed with some failed transactions.",

      result,
    });
  } catch (error: any) {
    console.error(
      "RECONCILIATION APPLY FATAL ERROR:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error?.message ||
          "An unexpected reconciliation error occurred.",
      },
      { status: 500 }
    );
  }
}
