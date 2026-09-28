import { canViewMeeting, getMeeting } from "@/lib/meetings";
import { createPresignedGet, readStoredFile } from "@/lib/storage";
import { getCurrentUser } from "@/lib/auth";

// Map the stored file's extension to the right MIME so <audio> reads duration
// and can seek. Recordings can be any container the browser produced.
const AUDIO_TYPES: Record<string, string> = {
  webm: "audio/webm",
  ogg: "audio/ogg",
  mp4: "audio/mp4",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  wav: "audio/wav",
};

// Turn a meeting title into something safe to put in a Content-Disposition
// filename: no quotes, no path separators, no control characters.
function safeFilename(title: string, fallback: string): string {
  const cleaned = title
    .replace(/[^\w\s.-]+/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
  return cleaned || fallback;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Recordings are private — require a valid SSO session to stream them.
  const user = await getCurrentUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await params;
  const meeting = await getMeeting(id);
  // 404 (not 403) for forbidden so a recording's existence doesn't leak.
  if (!meeting?.recordingPath || !canViewMeeting(meeting, user)) {
    return new Response("Not found", { status: 404 });
  }

  const ext = meeting.recordingPath.split(".").pop()?.toLowerCase() ?? "";
  const contentType = AUDIO_TYPES[ext] ?? "application/octet-stream";

  // ?download=1 → save-to-disk instead of playing inline. Same bytes, same
  // auth check; only the disposition changes, so the <audio> element and the
  // download button can share one route.
  const download = new URL(req.url).searchParams.get("download") === "1";
  const name = `${safeFilename(meeting.title, `meeting-${id}`)}.${ext}`;
  const disposition = `${download ? "attachment" : "inline"}; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`;
  const range = req.headers.get("range");

  // Stream from storage rather than materialising the file.
  //
  // This used to read the whole recording into a Buffer and then copy it again
  // into a Uint8Array — around 172 MB of heap per request for a three-hour
  // meeting, per concurrent listener. Worse, it advertised `Accept-Ranges: bytes`
  // while ignoring the Range header entirely, so every seek in the player
  // re-downloaded the entire file from the beginning. The sibling video route
  // already does this properly; this is the same approach.
  const signed = await createPresignedGet(meeting.recordingPath, 900);

  if (signed) {
    let upstream: Response;
    try {
      upstream = await fetch(signed, {
        // Range forwarded verbatim, so seeking is the storage layer's job.
        headers: range ? { Range: range } : {},
        // Closing the tab aborts the upstream fetch instead of leaving us
        // pulling a file nobody is listening to.
        signal: req.signal,
        cache: "no-store",
      });
    } catch {
      return new Response("Recording is unavailable right now", { status: 502 });
    }
    if (!upstream.ok || !upstream.body) {
      return new Response("Not found", { status: 404 });
    }

    const headers = new Headers({
      // Overridden rather than passed through: storage serves these as
      // application/octet-stream, and Firefox and Safari refuse to decode a
      // media element whose Content-Type isn't an audio type.
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
      "Content-Disposition": disposition,
      "Cache-Control": "private, max-age=0, must-revalidate",
    });
    for (const h of ["content-length", "content-range"] as const) {
      const v = upstream.headers.get(h);
      if (v) headers.set(h, v);
    }

    // 206 passed through intact — that is what makes seeking work.
    return new Response(upstream.body, { status: upstream.status, headers });
  }

  // Local disk (dev, no Spaces): small files, read them.
  try {
    const data = await readStoredFile(meeting.recordingPath);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(data.byteLength),
        "Accept-Ranges": "bytes",
        "Content-Disposition": disposition,
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
