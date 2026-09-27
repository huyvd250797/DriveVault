import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function config() {
  const url = process.env.GOOGLE_SCRIPT_URL?.trim();
  const apiKey = process.env.DRIVEVAULT_API_KEY?.trim();
  if (!url) throw new Error("GOOGLE_SCRIPT_URL chưa được cấu hình.");
  if (!url.endsWith("/exec")) throw new Error("GOOGLE_SCRIPT_URL phải là Web App URL kết thúc bằng /exec.");
  return { url, apiKey: apiKey || "" };
}

async function parseResponse(response: Response) {
  const text = await response.text();
  let data: any;
  try { data = JSON.parse(text); }
  catch {
    const preview = text.replace(/\s+/g, " ").slice(0, 180);
    throw new Error(`Google Apps Script không trả JSON hợp lệ. HTTP ${response.status}. Phản hồi: ${preview || "(trống)"}`);
  }
  if (!response.ok) throw new Error(data?.error || `Google Apps Script trả về ${response.status}`);
  if (data?.ok === false) throw new Error(data?.error || "Google Apps Script xử lý thất bại.");
  return data;
}

export async function GET() {
  try {
    const { url, apiKey } = config();
    const endpoint = new URL(url);
    endpoint.searchParams.set("action", "listClassifications");
    if (apiKey) endpoint.searchParams.set("apiKey", apiKey);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(endpoint, { cache: "no-store", redirect: "follow", signal: controller.signal });
      return NextResponse.json(await parseResponse(response));
    } finally { clearTimeout(timeout); }
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "Google Apps Script phản hồi quá chậm."
      : error instanceof Error ? error.message : "Không tải được phân loại.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { url, apiKey } = config();
    const body = await request.json();
    const name = String(body?.name || "").trim();
    if (!name) return NextResponse.json({ ok: false, error: "Tên phân loại không được để trống." }, { status: 400 });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "createClassification", apiKey, name }),
        cache: "no-store",
        redirect: "follow",
        signal: controller.signal,
      });
      return NextResponse.json(await parseResponse(response));
    } finally { clearTimeout(timeout); }
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "Google Apps Script phản hồi quá chậm."
      : error instanceof Error ? error.message : "Không tạo được phân loại.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
