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

async function postAction(action: string, payload: Record<string, unknown>, timeoutMs = 30000) {
  const { url, apiKey } = config();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, apiKey, ...payload }),
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
    });
    return await parseAppsScriptResponse(response);
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET() {
  try {
    const { url, apiKey } = config();
    const endpoint = new URL(url);
    endpoint.searchParams.set("action", "listBackups");
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
      : error instanceof Error ? error.message : "Không tải được lịch sử backup.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = String(body?.action || "");
    if (action === "backup") return NextResponse.json(await postAction("backup", { note: String(body.note || "") }));
    if (action === "restoreBackup") return NextResponse.json(await postAction("restoreBackup", { backupId: String(body.backupId || "") }));
    if (action === "deleteBackup") return NextResponse.json(await postAction("deleteBackup", { backupId: String(body.backupId || "") }));
    if (action === "import") {
      return NextResponse.json(await postAction("import", {
        mode: String(body.mode || "skip"),
        items: Array.isArray(body.items) ? body.items : [],
      }, 45000));
    }
    if (action === "emptyTrash") return NextResponse.json(await postAction("emptyTrash", {}));
    return NextResponse.json({ ok: false, error: "Action data không hợp lệ." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "Google Apps Script phản hồi quá chậm."
      : error instanceof Error ? error.message : "Không xử lý được dữ liệu.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
