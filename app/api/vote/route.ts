import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error:
        "Direct voting is disabled. Please use the Paystack payment process."
    },
    { status: 403 }
  );
}
