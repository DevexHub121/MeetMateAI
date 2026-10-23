import { canViewMeeting, getMeeting } from "@/lib/meetings";
import { createPresignedGet, localStoredFilePath } from "@/lib/storage";
import { getCurrentUser } from "@/lib/auth";
import { latestBotSession } from "@/lib/botStatus";
import { recallEnabled, videoUrlForBot } from "@/lib/recall";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { Readable } from "stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VIDEO_TYPES: Record<string, string> = {
  avi: "video/x-msvideo",
  m4v: "video/mp4",
  mkv: "video/x-matroska",
  mov: "video/quicktime",
  mp4: "video/mp4",
  ogv: "video/ogg",
  webm: "video/webm",
};

async function serveUploadedVideo(req: Request, path: string): Promise<Response> {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const contentType = VIDEO_TYPES[ext] ?? "application/octet-stream";
  const range = req.headers.get("range");
  const signed = await createPresignedGet(path, 900);

  if (signed) {
    let upstream: Response;
    try {
      upstream = await fetch(signed, {
        headers: range ? { Range: range } : {},
        signal: req.signal,
        cache: "no-store",
      });
    } catch (err) {
      if (req.signal.aborted) return new Response(null, { status: 499 });
      console.warn("[storage] uploaded video fetch failed:", err);
      return new Response("Video is unavailable right now", { status: 502 });
    }
    if (!upstream.ok || !upstream.body) {
      return new Response("Video is unavailable right now", { status: 502 });
    }
    const headers = new Headers({
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
    });
    for (const name of ["content-length", "content-range"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  }

  const localPath = localStoredFilePath(path);
  if (!localPath) return new Response("Not found", { status: 404 });

  try {
    const { size } = await stat(localPath);
    let start = 0;
    let end = size - 1;
    let status = 200;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || size === 0 || (!match[1] && !match[2])) {
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${size}` },
        });
      }
      if (match[1]) {
        start = Number(match[1]);
        if (match[2]) end = Math.min(Number(match[2]), end);
      } else {
        const suffixLength = Number(match[2]);
        start = Math.max(size - suffixLength, 0);
      }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${size}` },
        });
      }
      status = 206;
    }

    const headers = new Headers({
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
      "Content-Length": String(end - start + 1),
      "Cache-Control": "private, no-store",
    });
    if (status === 206) headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    const stream = createReadStream(localPath, { start, end });
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
      status,
      headers,
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

/** Authenticated video streaming for uploaded media and Recall bot recordings. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const meeting = await getMeeting(id);
  // 404 rather than 403, so a meeting's existence doesn't leak to non-viewers.
  if (!meeting || !canViewMeeting(meeting, user)) {
    return new Response("Not found", { status: 404 });
  }
  if (meeting.videoPath) return serveUploadedVideo(req, meeting.videoPath);
  if (!recallEnabled()) return new Response("Not found", { status: 404 });

  // Only bot-captured meetings have video. A phone or browser recording is
  // audio-only and there is nothing to look for.
  const session = await latestBotSession(id);
  if (!session) return new Response("Not found", { status: 404 });

  let url: string | null;
  try {
    url = await videoUrlForBot(session.botId);
  } catch (err) {
    console.warn("[recall] could not resolve video url:", err);
    return new Response("Video is unavailable right now", { status: 502 });
  }
  if (!url) return new Response("No video for this meeting", { status: 404 });

  // Forward Range verbatim so seeking is S3's job, not ours. req.signal means
  // closing the tab mid-stream aborts the upstream fetch instead of leaving us
  // pulling a 140 MB file nobody is watching.
  const range = req.headers.get("range");
  const pull = (target: string) =>
    fetch(target, {
      headers: range ? { Range: range } : {},
      signal: req.signal,
      cache: "no-store",
    });

  let upstream: Response;
  try {
    upstream = await pull(url);
    // S3 rejects a signature it no longer likes with a 403. Since the URL may
    // have come from cache, re-resolve once before believing it: without this,
    // a link invalidated early stays broken for everyone until the cached entry
    // ages out, which can be most of six hours.
    if (upstream.status === 403) {
      const fresh = await videoUrlForBot(session.botId, { refresh: true });
      if (fresh && fresh !== url) upstream = await pull(fresh);
    }
  } catch (err) {
    if (req.signal.aborted) return new Response(null, { status: 499 });
    console.warn("[recall] video fetch failed:", err);
    return new Response("Video is unavailable right now", { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    console.warn("[recall] video upstream returned", upstream.status);
    return new Response("Video is unavailable right now", { status: 502 });
  }

  const headers = new Headers({
    // The point of proxying. Upstream says binary/octet-stream; every browser
    // needs a real video type before it will decode a media element.
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    // Private content behind a session — never let a shared cache hold it.
    "Cache-Control": "no-store",
  });
  for (const h of ["content-length", "content-range"]) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }

  return new Response(upstream.body, { status: upstream.status, headers });
}
