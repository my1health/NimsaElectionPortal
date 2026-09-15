import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function getMetadata(transaction: any) {
  const metadata = transaction?.metadata;

  if (!metadata) return {};

  if (typeof metadata === "string") {
    try {
      return JSON.parse(metadata);
    } catch {
      return {};
    }
  }

  return metadata;
}

async function verifyPaystackTransaction(reference: string) {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;

  if (!secretKey) {
    throw new Error("PAYSTACK_SECRET_KEY is missing.");
  }

  const response = await fetch(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(
      reference
    )}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    }
  );

  const data = await response.json();

  if (!response.ok || !data.status || !data.data) {
    throw new Error(
      data?.message ||
        "Unable to verify transaction with Paystack."
    );
  }

  return data.data;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const references = Array.isArray(body?.references)
      ? body.references
          .map((reference: unknown) => String(reference).trim())
          .filter(Boolean)
      : [];

    if (references.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "No transaction references supplied.",
        },
        { status: 400 }
      );
    }

    const corrected: any[] = [];
    const skipped: any[] = [];

    for (const reference of references) {
      try {
        /*
         * IMPORTANT:
         * We verify EVERY transaction directly with Paystack.
         *
         * This prevents a Supabase-only record from being modified
         * accidentally.
         */
        const transaction =
          await verifyPaystackTransaction(reference);

        /*
         * ONLY successful Paystack transactions are eligible.
         */
        if (
          String(transaction.status).toLowerCase() !==
          "success"
        ) {
          skipped.push({
            reference,
            reason:
              "Skipped because Paystack does not currently report this transaction as successful.",
          });

          continue;
        }

        const metadata = getMetadata(transaction);

        const nomineeId = metadata?.nominee_id || null;
        const categoryId = metadata?.category_id || null;

        const paystackVoteCount = Number(
          metadata?.vote_count || 0
        );

        const paystackAmountKobo = Number(
          transaction?.amount || 0
        );

        const nomineeName =
          metadata?.nominee_name || null;

        const email =
          transaction?.customer?.email || null;

        /*
         * Never guess the nominee or vote count.
         */
        if (
          !nomineeId ||
          !categoryId ||
          !Number.isInteger(paystackVoteCount) ||
          paystackVoteCount <= 0
        ) {
          skipped.push({
            reference,
            reason:
              "Skipped because Paystack metadata does not contain valid nominee_id, category_id and vote_count.",
          });

          continue;
        }

        /*
         * Verify that the nominee actually exists.
         */
        const { data: nominee, error: nomineeError } =
          await supabase
            .from("nominees")
            .select("id, name, category_id")
            .eq("id", nomineeId)
            .maybeSingle();

        if (nomineeError) {
          throw new Error(
            `Nominee lookup failed: ${nomineeError.message}`
          );
        }

        if (!nominee) {
          skipped.push({
            reference,
            reason:
              "Skipped because the nominee in Paystack metadata does not exist in Supabase.",
          });

          continue;
        }

        /*
         * Find the payment using the Paystack reference.
         *
         * We NEVER search for an unrelated Supabase payment
         * and attach this transaction to it.
         */
        const { data: existingPayment, error: paymentError } =
          await supabase
            .from("payments")
            .select("*")
            .eq("reference", reference)
            .maybeSingle();

        if (paymentError) {
          throw new Error(
            `Payment lookup failed: ${paymentError.message}`
          );
        }

        /*
         * Count votes already recorded for THIS exact
         * Paystack transaction reference.
         */
        const { data: existingVotes, error: votesError } =
          await supabase
            .from("votes")
            .select("id")
            .eq("payment_reference", reference);

        if (votesError) {
          throw new Error(
            `Vote lookup failed: ${votesError.message}`
          );
        }

        const currentVoteCount =
          existingVotes?.length || 0;

        /*
         * SAFETY RULE:
         *
         * If the DB already contains MORE votes than Paystack
         * says were purchased, DO NOT DELETE ANYTHING.
         */
        if (currentVoteCount > paystackVoteCount) {
          skipped.push({
            reference,
            reason:
              `Skipped for manual review. Supabase has ${currentVoteCount} votes but Paystack metadata says ${paystackVoteCount}. No votes were deleted.`,
            currentVotes: currentVoteCount,
            paystackVotes: paystackVoteCount,
          });

          continue;
        }

        /*
         * Verify the payment amount if a payment already exists.
         *
         * We do not overwrite a conflicting amount automatically.
         */
        if (existingPayment) {
          const existingAmount = Number(
            existingPayment.amount_kobo ??
              existingPayment.amount ??
              0
          );

          if (
            existingAmount !== 0 &&
            existingAmount !== paystackAmountKobo
          ) {
            skipped.push({
              reference,
              reason:
                `Skipped for manual review because Supabase amount (${existingAmount} kobo) differs from Paystack amount (${paystackAmountKobo} kobo).`,
            });

            continue;
          }
        }

        let paymentCreated = false;
        let paymentStatusChanged = false;

        /*
         * CASE 1:
         *
         * Paystack successful but Supabase payment record
         * does not exist.
         *
         * Create ONLY this Paystack transaction.
         */
        if (!existingPayment) {
          const { error: insertPaymentError } =
            await supabase.from("payments").insert({
              reference,
              email,
              amount_kobo: paystackAmountKobo,
              amount: paystackAmountKobo,
              nominee_id: nomineeId,
              nominee_name:
                nominee?.name || nomineeName,
              category_id:
                nominee?.category_id || categoryId,
              status: "success",
            });

          if (insertPaymentError) {
            throw new Error(
              `Unable to create payment: ${insertPaymentError.message}`
            );
          }

          paymentCreated = true;
        } else {
          /*
           * CASE 2:
           *
           * Payment exists but isn't marked successful.
           *
           * Paystack has independently confirmed success,
           * so it is safe to mark THIS payment successful.
           */
          const currentStatus = String(
            existingPayment.status || ""
          ).toLowerCase();

          if (currentStatus !== "success") {
            const { error: updatePaymentError } =
              await supabase
                .from("payments")
                .update({
                  status: "success",
                })
                .eq("reference", reference);

            if (updatePaymentError) {
              throw new Error(
                `Unable to update payment status: ${updatePaymentError.message}`
              );
            }

            paymentStatusChanged = true;
          }
        }

        /*
         * Add ONLY votes that are genuinely missing.
         *
         * Example:
         * Paystack = 10
         * DB = 7
         * We insert exactly 3.
         */
        const missingVotes =
          paystackVoteCount - currentVoteCount;

        let votesAdded = 0;

        if (missingVotes > 0) {
          const voteRows = Array.from(
            { length: missingVotes },
            () => ({
              nominee_id: nomineeId,
              category_id:
                nominee?.category_id || categoryId,
              payment_reference: reference,
            })
          );

          const { error: insertVotesError } =
            await supabase
              .from("votes")
              .insert(voteRows);

          if (insertVotesError) {
            throw new Error(
              `Unable to add missing votes: ${insertVotesError.message}`
            );
          }

          votesAdded = missingVotes;
        }

        corrected.push({
          reference,

          nomineeId,
          nomineeName:
            nominee?.name || nomineeName,

          paystackAmountKobo,

          paystackVoteCount,

          previousVoteCount: currentVoteCount,

          votesAdded,

          finalVoteCount:
            currentVoteCount + votesAdded,

          paymentCreated,

          paymentStatusChanged,

          action:
            paymentCreated
              ? "Payment recovered and missing votes added."
              : paymentStatusChanged
              ? "Payment marked successful and missing votes added."
              : votesAdded > 0
              ? "Missing votes added."
              : "Payment already correct.",
        });
      } catch (error: any) {
        /*
         * One transaction failing must NOT stop the remaining
         * transactions from being checked.
         */
        skipped.push({
          reference,
          reason:
            error?.message ||
            "Unknown error while processing transaction.",
        });
      }
    }

    return NextResponse.json({
      success: true,

      message:
        "Paystack-safe reconciliation completed. Supabase-only records were not modified.",

      corrected,
      skipped,

      correctedCount: corrected.length,
      skippedCount: skipped.length,

      safety: {
        supabaseOnlyRecordsModified: false,
        unsuccessfulPaystackTransactionsModified: false,
        extraVotesDeleted: false,
        amountMismatchesAutomaticallyChanged: false,
      },
    });
  } catch (error: any) {
    console.error(
      "PAYSTACK RECONCILIATION APPLY ERROR:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error?.message ||
          "Unable to apply reconciliation corrections.",
      },
      { status: 500 }
    );
  }
}
