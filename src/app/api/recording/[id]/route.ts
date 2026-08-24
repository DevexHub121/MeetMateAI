import { canViewMeeting, getMeeting } from "@/lib/meetings";
import { readStoredFile } from "@/lib/storage";
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

  try {
    const data = await readStoredFile(meeting.recordingPath);
    const ext = meeting.recordingPath.split(".").pop()?.toLowerCase() ?? "";
    const contentType = AUDIO_TYPES[ext] ?? "application/octet-stream";
    const body = new Uint8Array(data);

    // ?download=1 → save-to-disk instead of playing inline. Same bytes, same
    // auth check; only the disposition changes, so the <audio> element and the
    // download button can share one route.
    const download =
      new URL(req.url).searchParams.get("download") === "1";
    const name = `${safeFilename(meeting.title, `meeting-${id}`)}.${ext}`;
    const disposition = download ? "attachment" : "inline";

    return new Response(body, {
      headers: {
        "Content-Type": contentType,
        // Content-Length + Accept-Ranges let the browser show the real duration
        // and seek within the clip instead of streaming it as unknown-length.
        "Content-Length": String(body.byteLength),
        "Accept-Ranges": "bytes",
        "Content-Disposition": `${disposition}; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
