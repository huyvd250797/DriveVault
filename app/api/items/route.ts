import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function config() {
  const url = process.env.GOOGLE_SCRIPT_URL;
  const apiKey = process.env.DRIVEVAULT_API_KEY;
  if (!url) throw new Error("GOOGLE_SCRIPT_URL chưa được cấu hình.");
  return { url, apiKey: apiKey || "" };
}

export async function GET() {
  try {
    const { url, apiKey } = config();
    const endpoint = new URL(url);
    endpoint.searchParams.set("action", "list");
    if (apiKey) endpoint.searchParams.set("apiKey", apiKey);

    const response = await fetch(endpoint, { cache: "no-store", redirect: "follow" });
    const text = await response.text();
    if (!response.ok) throw new Error(text || `Google Apps Script trả về ${response.status}`);
    return new NextResponse(text, { status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Không tải được dữ liệu." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url, apiKey } = config();
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "create", apiKey, item: body }),
      cache: "no-store",
      redirect: "follow",
    });
    const text = await response.text();
    if (!response.ok) throw new Error(text || `Google Apps Script trả về ${response.status}`);
    return new NextResponse(text, { status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Không lưu được dữ liệu." }, { status: 500 });
  }
}
