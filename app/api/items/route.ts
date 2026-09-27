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

async function parseAppsScriptResponse(response: Response) {
  const text = await response.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    const preview = text.replace(/\s+/g, " ").slice(0, 180);
    throw new Error(`Google Apps Script không trả JSON hợp lệ. HTTP ${response.status}. Phản hồi: ${preview || "(trống)"}`);
  }
  if (!response.ok) throw new Error(data?.error || `Google Apps Script trả về ${response.status}`);
  if (data?.ok === false) throw new Error(data?.error || "Google Apps Script xử lý thất bại.");
  return data;
}

async function callAppsScript(body: string, url: string, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "text/plain;charset=utf-8" },
      body,
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
    });
    return await parseAppsScriptResponse(response);
  } finally {
    clearTimeout(timeout);
  }
}

async function postAction(action: string, payload: Record<string, unknown>) {
  const { url, apiKey } = config();
  const body = JSON.stringify({ action, apiKey, ...payload });
  try {
    return await callAppsScript(body, url);
  } catch (error) {
    // Create và bulk đều idempotent theo ID nên retry an toàn.
    if (action !== "create" && action !== "bulk") throw error;
    await new Promise((resolve) => setTimeout(resolve, 350));
    return await callAppsScript(body, url, 12000);
  }
}

export async function GET() {
  try {
    const { url, apiKey } = config();
    const endpoint = new URL(url);
    endpoint.searchParams.set("action", "list");
    if (apiKey) endpoint.searchParams.set("apiKey", apiKey);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(endpoint, { cache: "no-store", redirect: "follow", signal: controller.signal });
      return NextResponse.json(await parseAppsScriptResponse(response));
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "Google Apps Script phản hồi quá chậm."
      : error instanceof Error ? error.message : "Không tải được dữ liệu.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const item = body?.item ?? body;
    return NextResponse.json(await postAction("create", { item }));
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "Google Apps Script phản hồi quá chậm. Dữ liệu vẫn được giữ trong hàng đợi đồng bộ."
      : error instanceof Error ? error.message : "Không lưu được dữ liệu.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const item = await request.json();
    return NextResponse.json(await postAction("update", { item }));
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "Google Apps Script phản hồi quá chậm."
      : error instanceof Error ? error.message : "Không cập nhật được dữ liệu.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    if (body?.action === "pin") {
      return NextResponse.json(await postAction("pin", { id: body.id, pinned: Boolean(body.pinned) }));
    }
    if (body?.action === "use") {
      return NextResponse.json(await postAction("use", {
        id: body.id,
        useCount: Number(body.useCount || 0),
        lastUsedAt: String(body.lastUsedAt || ""),
      }));
    }
    if (body?.action === "bulk") {
      return NextResponse.json(await postAction("bulk", {
        mode: String(body.mode || ""),
        ids: Array.isArray(body.ids) ? body.ids : [],
        collection: String(body.collection || ""),
      }));
    }
    return NextResponse.json({ ok: false, error: "Action PATCH không hợp lệ." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "Google Apps Script phản hồi quá chậm."
      : error instanceof Error ? error.message : "Không đồng bộ được thao tác.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    return NextResponse.json(await postAction("delete", { id: body?.id }));
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "Google Apps Script phản hồi quá chậm."
      : error instanceof Error ? error.message : "Không xóa được dữ liệu.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
