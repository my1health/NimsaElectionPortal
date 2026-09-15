import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY!;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

type PaystackTransaction = {
  reference: string;
  status: string;
  amount: number;
  currency?: string;
  customer?: {
    email?: string;
  };
  metadata?: any;
};

function getVoteCount(metadata: any) {
  const value =
    metadata?.vote_count ??
    metadata?.voteCount ??
    metadata?.votes ??
    metadata?.quantity ??
    0;

  const count = Number(value);

  return Number.isFinite(count) && count >= 0
    ? count
    : 0;
}

function getNomineeId(metadata: any) {
  return (
    metadata?.nominee_id ??
    metadata?.nomineeId ??
    null
  );
}

function getCategoryId(metadata: any) {
  return (
    metadata?.category_id ??
    metadata?.categoryId ??
    null
  );
}

function getEmail(transaction: PaystackTransaction) {
  return (
    transaction.customer?.email ??
    transaction.metadata?.email ??
    null
  );
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

  if (!response.ok) {
    const text = await response.text();

    throw new Error(
      `Paystack verification failed (${response.status}): ${text}`
    );
  }

  const data = await response.json();

  if (!data.status || !data.data) {
    throw new Error(
      data.message ||
        "Unable to verify Paystack transaction"
    );
  }

  return data.data;
}

export async function POST(request: Request) {
  try {
    if (!PAYSTACK_SECRET_KEY) {
      return NextResponse.json(
        {
          success: false,
          error:
            "PAYSTACK_SECRET_KEY is not configured",
        },
        { status: 500 }
      );
    }

    if (
      !SUPABASE_URL ||
      !SUPABASE_SERVICE_ROLE_KEY
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Supabase service-role environment variables are missing",
        },
        { status: 500 }
      );
    }

    const body = await request.json();

    const references = Array.isArray(
      body?.references
    )
      ? body.references
      : [];

    if (!references.length) {
      return NextResponse.json({
        success: true,
        message: "Nothing to correct.",
        corrected: [],
        skipped: [],
      });
    }

    const corrected: any[] = [];
    const skipped: any[] = [];

    for (const rawReference of references) {
      const reference =
        String(rawReference || "").trim();

      if (!reference) {
        continue;
      }

      try {
        /*
         * VERY IMPORTANT:
         *
         * We independently verify the transaction with Paystack.
         *
         * This means the frontend cannot tell this API to make
         * an arbitrary Supabase payment successful.
         */
        const transaction =
          await verifyPaystackTransaction(
            reference
          );

        /*
         * ONLY Paystack SUCCESS is allowed.
         */
        if (
          String(transaction.status).toLowerCase() !==
          "success"
        ) {
          skipped.push({
            reference,
            reason:
              `Paystack status is "${transaction.status}", not "success".`,
          });

          continue;
        }

        const paystackAmountKobo =
          Number(transaction.amount || 0);

        const metadata =
          transaction.metadata || {};

        const nomineeId =
          getNomineeId(metadata);

        const categoryId =
          getCategoryId(metadata);

        const paystackVoteCount =
          getVoteCount(metadata);

        const email =
          getEmail(transaction);

        /*
         * We need the voting metadata before recovering votes.
         */
        if (
          !nomineeId ||
          !categoryId ||
          !paystackVoteCount
        ) {
          skipped.push({
            reference,
            reason:
              "Paystack is successful but nominee_id, category_id or vote_count is missing from metadata.",
          });

          continue;
        }

        /*
         * Confirm nominee exists.
         *
         * We do NOT require the nominee to currently be active.
         * A valid historical successful payment must still be
         * reconciled.
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
              `Nominee ${nomineeId} no longer exists in Supabase.`,
          });

          continue;
        }

        /*
         * Find existing Supabase payment.
         *
         * We support both reference and payment_reference
         * because your database may contain either field.
         */
        const { data: existingPayments, error: paymentLookupError } =
          await supabase
            .from("payments")
            .select("*")
            .or(
              `reference.eq.${reference},payment_reference.eq.${reference}`
            )
            .limit(1);

        if (paymentLookupError) {
          throw new Error(
            `Payment lookup failed: ${paymentLookupError.message}`
          );
        }

        const existingPayment =
          existingPayments?.[0] || null;

        /*
         * ---------------------------------------------------------
         * CASE 1:
         * Payment does not exist in Supabase.
         * ---------------------------------------------------------
         */
        if (!existingPayment) {
          const { error: insertPaymentError } =
            await supabase
              .from("payments")
              .insert({
                reference,
                amount_kobo:
                  paystackAmountKobo,
                amount:
                  paystackAmountKobo,
                vote_count:
                  paystackVoteCount,
                nominee_id:
                  nomineeId,
                category_id:
                  categoryId,
                email,
                status: "success",
              });

          if (insertPaymentError) {
            throw new Error(
              `Unable to create missing payment: ${insertPaymentError.message}`
            );
          }

          /*
           * Add the votes below.
           */
        } else {
          /*
           * -------------------------------------------------------
           * CASE 2:
           * Payment exists.
           *
           * PAYSTACK IS THE SOURCE OF TRUTH FOR STATUS.
           *
           * Therefore:
           * pending -> success
           * failed -> success
           * processing -> success
           * anything else -> success
           *
           * BUT ONLY because Paystack independently verified success.
           * -------------------------------------------------------
           */

          const supabaseAmountKobo =
            Number(
              existingPayment.amount_kobo ??
                existingPayment.amount ??
                0
            );

          /*
           * Never automatically overwrite an amount mismatch.
           *
           * This protects you against accidental data corruption.
           */
          if (
            supabaseAmountKobo !==
            paystackAmountKobo
          ) {
            skipped.push({
              reference,
              reason:
                `Amount mismatch. Paystack: ${paystackAmountKobo} kobo; Supabase: ${supabaseAmountKobo} kobo. Payment status was NOT changed automatically.`,
            });

            continue;
          }

          /*
           * Update payment status to SUCCESS if necessary.
           */
          const currentStatus =
            String(
              existingPayment.status || ""
            ).toLowerCase();

          if (currentStatus !== "success") {
            const { error: statusUpdateError } =
              await supabase
                .from("payments")
                .update({
                  status: "success",
                })
                .eq("id", existingPayment.id);

            if (statusUpdateError) {
              throw new Error(
                `Unable to mark payment successful: ${statusUpdateError.message}`
              );
            }
          }
        }

        /*
         * ---------------------------------------------------------
         * NOW RECONCILE THE VOTES.
         * ---------------------------------------------------------
         */

        const { data: existingVotes, error: voteLookupError } =
          await supabase
            .from("votes")
            .select("id")
            .eq(
              "payment_reference",
              reference
            );

        if (voteLookupError) {
          throw new Error(
            `Vote lookup failed: ${voteLookupError.message}`
          );
        }

        const existingVoteCount =
          existingVotes?.length || 0;

        /*
         * Never delete votes.
         *
         * If Supabase has MORE votes than Paystack expects,
         * stop and require manual review.
         */
        if (
          existingVoteCount >
          paystackVoteCount
        ) {
          skipped.push({
            reference,
            reason:
              `Supabase has ${existingVoteCount} votes but Paystack metadata expects ${paystackVoteCount}. No votes were deleted.`,
          });

          continue;
        }

        /*
         * Calculate exactly how many votes are missing.
         */
        const missingVoteCount =
          paystackVoteCount -
          existingVoteCount;

        /*
         * Add ONLY the missing votes.
         */
        if (missingVoteCount > 0) {
          const votesToInsert = Array.from(
            {
              length: missingVoteCount,
            },
            () => ({
              nominee_id: nomineeId,
              category_id: categoryId,
              payment_reference: reference,
            })
          );

          const { error: insertVotesError } =
            await supabase
              .from("votes")
              .insert(votesToInsert);

          if (insertVotesError) {
            throw new Error(
              `Unable to insert missing votes: ${insertVotesError.message}`
            );
          }
        }

        corrected.push({
          reference,
          nomineeId,
          nomineeName: nominee.name,
          categoryId,

          paystackAmountKobo,

          previousSupabaseStatus:
            existingPayment?.status ??
            "missing",

          newSupabaseStatus: "success",

          paystackVoteCount,
          previousSupabaseVoteCount:
            existingVoteCount,

          votesAdded:
            Math.max(
              0,
              missingVoteCount
            ),

          paymentCreated:
            !existingPayment,

          paymentStatusCorrected:
            !!existingPayment &&
            String(
              existingPayment.status || ""
            ).toLowerCase() !== "success",
        });
      } catch (error: any) {
        console.error(
          `Failed to reconcile ${reference}:`,
          error
        );

        skipped.push({
          reference,
          reason:
            error?.message ||
            "Unknown reconciliation error",
        });
      }
    }

    return NextResponse.json({
      success: true,

      message:
        "Paystack successful transactions were safely reconciled with Supabase.",

      corrected,
      skipped,

      summary: {
        processed: references.length,
        corrected: corrected.length,
        skipped: skipped.length,

        paymentsCreated:
          corrected.filter(
            (item) => item.paymentCreated
          ).length,

        paymentStatusesCorrected:
          corrected.filter(
            (item) =>
              item.paymentStatusCorrected
          ).length,

        votesAdded:
          corrected.reduce(
            (total, item) =>
              total +
              Number(item.votesAdded || 0),
            0
          ),
      },
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
          "Failed to apply reconciliation",
      },
      { status: 500 }
    );
  }
}
