import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Missing Supabase server environment variables.");
  }

  return createClient(url, key);
}

export async function GET() {
  try {
    const db = getAdminClient();

    const { data: categories, error: categoryError } = await db
      .from("categories")
      .select("*")
      .order("created_at");

    if (categoryError) {
      throw categoryError;
    }

    const { data: nominees, error: nomineeError } = await db
      .from("nominees")
      .select("*")
      .eq("is_active", true)
      .order("name");

    if (nomineeError) {
      throw nomineeError;
    }

    const { data: votes, error: voteError } = await db
      .from("votes")
      .select("nominee_id");

    if (voteError) {
      throw voteError;
    }

    const counts: Record<string, number> = {};

    for (const vote of votes || []) {
      counts[vote.nominee_id] =
        (counts[vote.nominee_id] || 0) + 1;
    }

    const results = (nominees || []).map((nominee) => ({
      ...nominee,
      votes: counts[nominee.id] || 0,
    }));

    return NextResponse.json({
      categories: categories || [],
      nominees: nominees || [],
      results,
    });
  } catch (error: any) {
    console.error("Categories API error:", error);

    return NextResponse.json(
      {
        error: error?.message || "Failed to load voting data.",
      },
      { status: 500 }
    );
  }
}
