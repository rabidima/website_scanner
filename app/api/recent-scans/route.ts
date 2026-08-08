import { NextRequest, NextResponse } from "next/server";
import { resolveCorsOrigin, corsHeaders } from "@/lib/cors";
import { recentScansStore } from "@/lib/recent-scans";

export const runtime = "nodejs";

// Read-only, no gate/rate-limit needed — this just powers the trust strip
// and returns nothing that isn't already public (domain + detected tech).
export async function OPTIONS(req: NextRequest) {
  const origin = resolveCorsOrigin(req.headers.get("origin"));
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}

export async function GET(req: NextRequest) {
  const origin = resolveCorsOrigin(req.headers.get("origin"));
  const headers = corsHeaders(origin);

  try {
    const scans = await recentScansStore.list();
    return NextResponse.json({ scans }, { status: 200, headers });
  } catch (err) {
    console.error("Failed to read recent scans:", err);
    // Fail soft — an empty list just means the trust strip doesn't render,
    // not a broken page.
    return NextResponse.json({ scans: [] }, { status: 200, headers });
  }
}
