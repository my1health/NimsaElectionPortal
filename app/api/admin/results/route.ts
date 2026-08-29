import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET() {
  try {
    const db = supabaseAdmin();

    // Get categories
    const {
      data: categories,
      error: categoryError,
    } = await db
      .from("categories")
      .select("id, name")
      .order("created_at");

    if (categoryError) {
      throw categoryError;
    }

    // Get nominees
    const {
      data: nominees,
      error: nomineeError,
    } = await db
      .from("nominees")
      .select(
        "id, name, bio, category_id, photo_url, is_active"
      )
      .order("name");

    if (nomineeError) {
      throw nomineeError;
    }

    // Get all verified votes
    const {
      data: votes,
      error: voteError,
    } = await db
      .from("votes")
      .select(
        "id, nominee_id, category_id, email, payment_reference"
      );

    if (voteError) {
      throw voteError;
    }

    // Count votes
    const voteCounts: Record<string, number> = {};

    for (const vote of votes || []) {
      voteCounts[vote.nominee_id] =
        (voteCounts[vote.nominee_id] || 0) + 1;
    }

    // Build results
    const results = (nominees || []).map(
      (nominee) => ({
        id: nominee.id,
        name: nominee.name,
        bio: nominee.bio,
        category_id: nominee.category_id,
        photo_url: nominee.photo_url,
        is_active: nominee.is_active,
        votes:
          voteCounts[nominee.id] || 0,
      })
    );

    // Group results by category
    const categoryResults = (
      categories || []
    ).map((category) => {

      const categoryNominees =
        results
          .filter(
            (nominee) =>
              nominee.category_id ===
              category.id
          )
          .sort(
            (a, b) =>
              b.votes - a.votes
          );

      return {
        id: category.id,
        name: category.name,
        nominees: categoryNominees,
        totalVotes:
          categoryNominees.reduce(
            (total, nominee) =>
              total + nominee.votes,
            0
          ),
      };
    });

    return NextResponse.json({
      success: true,
      categories: categoryResults,
      totalVotes: votes?.length || 0,
    });

  } catch (error: any) {

    console.error(
      "Admin results error:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error?.message ||
          "Unable to load voting results.",
      },
      {
        status: 500,
      }
    );
  }
}
