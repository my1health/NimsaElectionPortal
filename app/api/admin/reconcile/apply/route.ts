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

async function getPaystackTransaction(reference: string) {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;

  if (!secretKey) {
    throw new Error("PAYSTACK_SECRET_KEY is missing");
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

  if (!response.ok || !data.status) {
    throw new Error(
      data?.message ||
        `Unable to verify Paystack transaction ${reference}`
    );
  }

  return data.data;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const references = Array.isArray(body?.references)
      ? body.references
      : [];

    if (!references.length) {
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

    for (const rawReference of references) {
      const reference = String(rawReference);

      try {
        const transaction =
          await getPaystackTransaction(reference);

        if (
          String(transaction.status).toLowerCase() !==
          "success"
        ) {
          skipped.push({
            reference,
            reason: "Paystack transaction is not successful.",
          });

          continue;
        }

        const metadata = getMetadata(transaction);

        const nomineeId = metadata.nominee_id;
        const categoryId = metadata.category_id;
        const nomineeName = metadata.nominee_name || null;
        const voteCount = Number(metadata.vote_count || 0);
        const amountKobo = Number(transaction.amount || 0);
        const email =
          transaction.customer?.email || null;

        if (!nomineeId || !categoryId || voteCount <= 0) {
          skipped.push({
            reference,
            reason:
              "Required Paystack metadata is missing: nominee_id, category_id or vote_count.",
          });

          continue;
        }

        /*
         * Verify nominee exists before creating votes.
         */
        const { data: nominee, error: nomineeError } =
          await supabase
            .from("nominees")
            .select("id, name, category_id")
            .eq("id", nomineeId)
            .maybeSingle();

        if (nomineeError) {
          throw nomineeError;
        }

        if (!nominee) {
          skipped.push({
            reference,
            reason:
              "Nominee from Paystack metadata no longer exists.",
          });

          continue;
        }

        /*
         * Check the existing payment record.
         */
        const { data: existingPayment, error: paymentLookupError } =
          await supabase
            .from("payments")
            .select("*")
            .eq("reference", reference)
            .maybeSingle();

        if (paymentLookupError) {
          throw paymentLookupError;
        }

        /*
         * Count votes already recorded for this transaction.
         */
        const { data: existingVotes, error: votesError } =
          await supabase
            .from("votes")
            .select("id")
            .eq("payment_reference", reference);

        if (votesError) {
          throw votesError;
        }

        const currentVoteCount =
          existingVotes?.length || 0;

        if (currentVoteCount > voteCount) {
          skipped.push({
            reference,
            reason: `Supabase already has ${currentVoteCount} votes, but Paystack metadata says ${voteCount}. No votes were deleted.`,
          });

          continue;
        }

        /*
         * Create or repair payment record.
         */
        if (!existingPayment) {
          const { error: insertPaymentError } =
            await supabase.from("payments").insert({
              reference,
              email,
              amount_kobo: amountKobo,
              amount: amountKobo,
              nominee_id: nomineeId,
              nominee_name:
                nominee.name || nomineeName,
              category_id:
                nominee.category_id || categoryId,
              status: "success",
            });

          if (insertPaymentError) {
            throw insertPaymentError;
          }
        } else if (
          String(existingPayment.status).toLowerCase() !==
          "success"
        ) {
          const { error: updatePaymentError } =
            await supabase
              .from("payments")
              .update({
                status: "success",
                amount_kobo: amountKobo,
                amount: amountKobo,
                nominee_id: nomineeId,
                nominee_name:
                  nominee.name || nomineeName,
                category_id:
                  nominee.category_id || categoryId,
                email:
                  existingPayment.email || email,
              })
              .eq("reference", reference);

          if (updatePaymentError) {
            throw updatePaymentError;
          }
        }

        /*
         * Add ONLY the missing votes.
         */
        const missingCount =
          voteCount - currentVoteCount;

        if (missingCount > 0) {
          const rows = Array.from(
            { length: missingCount },
            () => ({
              nominee_id: nomineeId,
              category_id:
                nominee.category_id || categoryId,
              payment_reference: reference,
            })
          );

          const { error: insertVotesError } =
            await supabase
              .from("votes")
              .insert(rows);

          if (insertVotesError) {
            throw insertVotesError;
          }
        }

        corrected.push({
          reference,
          previousVotes: currentVoteCount,
          expectedVotes: voteCount,
          addedVotes: missingCount,
          paymentCreated: !existingPayment,
        });
      } catch (error: any) {
        skipped.push({
          reference,
          reason:
            error?.message ||
            "Unknown error while applying correction.",
        });
      }
    }

    return NextResponse.json({
      success: true,
      corrected,
      skipped,
      correctedCount: corrected.length,
      skippedCount: skipped.length,
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
