import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET() {
  try {
    const db = supabaseAdmin();

    // Get all categories
    const {
      data: categories,
      error: categoryError,
    } = await db
      .from("categories")
      .select("id, name, description")
      .order("created_at");

    if (categoryError) {
      throw categoryError;
    }

    // Get only active nominees
    const {
      data: nominees,
      error: nomineeError,
    } = await db
      .from("nominees")
      .select(
        "id, name, bio, category_id, photo_url"
      )
      .eq("is_active", true)
      .order("name");

    if (nomineeError) {
      throw nomineeError;
    }

    /*
     * IMPORTANT:
     *
     * Do NOT query the votes table here.
     *
     * Vote totals are private and will only
     * be available through the admin dashboard.
     */

    return NextResponse.json({
      categories: categories || [],
      nominees: nominees || [],
    });
  } catch (error: any) {
    console.error(
      "Categories API error:",
      error
    );

    return NextResponse.json(
      {
        error:
          error?.message ||
          "Failed to load voting data.",
      },
      { status: 500 }
    );
  }
}
