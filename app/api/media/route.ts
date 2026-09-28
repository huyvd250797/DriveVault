import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function validFileId(value: string) {
  return /^[a-zA-Z0-9_-]{10,200}$/.test(value);
}

export async function GET(request: NextRequest) {
  const fileId = request.nextUrl.searchParams.get("fileId")?.trim() || "";
  if (!validFileId(fileId)) {
    return new Response("Invalid Drive file id", { status: 400 });
  }

  const range = request.headers.get("range");
  const metadataOnly = request.nextUrl.searchParams.get("meta") === "1";
  const resourceKey = request.nextUrl.searchParams.get("resourceKey")?.trim() || "";
  const resourceKeyParam = resourceKey ? `&resourcekey=${encodeURIComponent(resourceKey)}` : "";
  const upstreamUrl = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t${resourceKeyParam}`;
  const headers = new Headers();
  if (metadataOnly) headers.set("range", "bytes=0-0");
  else if (range) headers.set("range", range);
  headers.set("user-agent", "DriveVault/2.2-media-fix1");

  try {
    const upstream = await fetch(upstreamUrl, {
      headers,
      redirect: "follow",
      cache: "no-store",
    });

    if (!upstream.ok && upstream.status !== 206) {
      return new Response("Không đọc được media từ Google Drive. Hãy kiểm tra quyền chia sẻ link.", { status: upstream.status || 502 });
    }

    if (metadataOnly) {
      const contentType = upstream.headers.get("content-type") || "";
      const kind = contentType.startsWith("image/") ? "image" : contentType.startsWith("video/") ? "video" : "unknown";
      return Response.json({ contentType, kind });
    }

    const responseHeaders = new Headers();
    for (const key of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
      const value = upstream.headers.get(key);
      if (value) responseHeaders.set(key, value);
    }
    responseHeaders.set("cache-control", "private, max-age=300");
    responseHeaders.set("content-disposition", "inline");

    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    return new Response("Không thể kết nối Google Drive media.", { status: 502 });
  }
}
