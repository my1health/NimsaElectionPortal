import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(req: Request) {
  try {
    const { nomineeId, email } = await req.json();
    if (!nomineeId || !email || !String(email).includes("@")) {
      return NextResponse.json({error:"Valid nominee and email are required."},{status:400});
    }

    const db = supabase();

    const { data: nominee, error: ne } = await db
      .from("nominees").select("id,category_id,is_active").eq("id", nomineeId).single();

    if (ne || !nominee || !nominee.is_active)
      return NextResponse.json({error:"Nominee not found or inactive."},{status:404});

    const cleanEmail = String(email).trim().toLowerCase();

    const { data: existing } = await db
      .from("votes")
      .select("id")
      .eq("email", cleanEmail)
      .eq("category_id", nominee.category_id)
      .maybeSingle();

    if (existing)
      return NextResponse.json({error:"You have already voted in this category."},{status:409});

    const { error: ve } = await db.from("votes").insert({
      nominee_id: nominee.id,
      category_id: nominee.category_id,
      email: cleanEmail
    });

    if (ve) {
      if (ve.code === "23505")
        return NextResponse.json({error:"You have already voted in this category."},{status:409});
      throw ve;
    }

    return NextResponse.json({success:true});
  } catch (e:any) {
    return NextResponse.json({error:e.message || "Vote failed."},{status:500});
  }
}