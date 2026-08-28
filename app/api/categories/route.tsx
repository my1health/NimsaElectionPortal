import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET() {
  try {
    console.log("Starting categories API");

    const db = supabase();

    console.log("Supabase client created");

    const { data: categories, error: ce } = await db
      .from("categories")
      .select("*")
      .order("created_at");

    if (ce) {
      console.error("Categories error:", ce);
      throw ce;
    }

    console.log("Categories loaded:", categories?.length);

    const { data: nominees, error: ne } = await db
      .from("nominees")
      .select("*")
      .eq("is_active", true)
      .order("name");

    if (ne) {
      console.error("Nominees error:", ne);
      throw ne;
    }

    console.log("Nominees loaded:", nominees?.length);

    const { data: votes, error: ve } = await db
      .from("votes")
      .select("nominee_id");

    if (ve) {
      console.error("Votes error:", ve);
      throw ve;
    }

    console.log("Votes loaded:", votes?.length);

    const counts: Record<string, number> = {};

    for (const v of votes || []) {
      counts[v.nominee_id] =
        (counts[v.nominee_id] || 0) + 1;
    }

    const results = (nominees || []).map((n) => ({
      ...n,
      votes: counts[n.id] || 0,
    }));

    return NextResponse.json({
      categories: categories || [],
      nominees: nominees || [],
      results,
    });

  } catch (e: any) {

    console.error("API ERROR:", e);

    return NextResponse.json(
      {
        error:
          e?.message ||
          "Unknown server error",
        details: e
      },
      { status: 500 }
    );
  }
}
