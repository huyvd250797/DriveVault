import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const params = new URLSearchParams({ quick: "1" });
  const title = String(form.get("title") || "").trim();
  const text = String(form.get("text") || "").trim();
  const url = String(form.get("url") || "").trim();
  if (title) params.set("shareTitle", title.slice(0, 240));
  if (text) params.set("shareText", text.slice(0, 8000));
  if (url) params.set("shareUrl", url.slice(0, 2048));
  return NextResponse.redirect(new URL(`/?${params.toString()}`, request.url), 303);
}

export async function GET(request: NextRequest) {
  return NextResponse.redirect(new URL("/?quick=1", request.url), 302);
}
