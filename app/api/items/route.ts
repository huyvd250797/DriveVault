import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function config() {
  const url = process.env.GOOGLE_SCRIPT_URL;
  const apiKey = process.env.DRIVEVAULT_API_KEY;
  if (!url) throw new Error("GOOGLE_SCRIPT_URL chưa được cấu hình.");
  return { url, apiKey: apiKey || "" };
}

async function parseAppsScriptResponse(response: Response) {
  const text = await response.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    const preview = text.replace(/\s+/g, " ").slice(0, 160);
    throw new Error(`Google Apps Script không trả JSON hợp lệ. Phản hồi: ${preview || "(trống)"}`);
  }
  if (!response.ok) throw new Error(`Google Apps Script trả về ${response.status}`);
  return data;
}

async function postAction(action: string, payload: Record<string, unknown>) {
  const { url, apiKey } = config();
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, apiKey, ...payload }),
    cache: "no-store",
    redirect: "follow",
  });
  return parseAppsScriptResponse(response);
}

export async function GET() {
  try {
    const { url, apiKey } = config();
    const endpoint = new URL(url);
    endpoint.searchParams.set("action", "list");
    if (apiKey) endpoint.searchParams.set("apiKey", apiKey);
    const response = await fetch(endpoint, { cache: "no-store", redirect: "follow" });
    const data = await parseAppsScriptResponse(response);
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Không tải được dữ liệu." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const item = await request.json();
    return NextResponse.json(await postAction("create", { item }));
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Không lưu được dữ liệu." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const item = await request.json();
    return NextResponse.json(await postAction("update", { item }));
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Không cập nhật được dữ liệu." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { id } = await request.json();
    return NextResponse.json(await postAction("delete", { id }));
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Không xóa được dữ liệu." }, { status: 500 });
  }
}
