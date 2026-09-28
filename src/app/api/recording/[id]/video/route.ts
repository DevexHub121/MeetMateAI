import { canViewMeeting, getMeeting } from "@/lib/meetings";
import { getCurrentUser } from "@/lib/auth";
import { latestBotSession } from "@/lib/botStatus";
import { recallEnabled, videoUrlForBot } from "@/lib/recall";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The note-taker's video, for meetings a bot recorded.
 *
 * MeetMate deliberately stores only the audio: an hour of mixed video is ~140 MB
 * against ~15 MB for the MP3, the pipeline never looks at the picture, and
 * reading a file that size into a Buffer is what got a worker OOM-killed and
 * left a meeting stuck for twelve hours. Keeping a second copy of every meeting
 * purely so it can be watched occasionally would multiply the storage bill by
 * ten to earn that back. Recall already holds it, under `retention: forever`,
 * on S3.
 *
 * So the bytes come from Recall on demand. This route streams them through
 * rather than redirecting to the presigned URL, which is worth the bandwidth
 * for two reasons found by measuring the real thing:
 *
 *   - Recall's S3 objects are served as `binary/octet-stream`, not `video/mp4`.
 *     Firefox and Safari refuse to decode a media element whose Content-Type
 *     isn't a video type, so a redirect plays in Chrome and silently fails
 *     elsewhere. The URL is a v2 presigned link (AWSAccessKeyId/Signature/
 *     Expires), and adding `response-content-type` invalidates the signature —
 *     verified, it 403s. Overriding the header on the way past is the only fix.
 *   - A redirect hands the browser a URL that reaches the bytes without an MeetMate
 *     session until it expires. Streaming keeps the presigned URL server-side,
 *     so access stays tied to the session on every request.
 *
 * Nothing is buffered: the upstream body is piped straight to the client, so
 * memory stays flat regardless of file size — the OOM above came from
 * materialising a Buffer, which is exactly what this avoids. Range headers are
 * forwarded and 206 responses passed through intact, so seeking in a long
 * recording works properly. (The sibling audio route can't do that: it
 * materialises the whole file and advertises Accept-Ranges without honouring
 * Range, which is survivable for a 15 MB MP3 and would be miserable here.)
 *
 * The tradeoff to know about: this depends on Recall's retention staying
 * generous. Videos are not ours, and if that setting ever changes they go away
 * without MeetMate noticing. The audio, transcript and minutes are all ours and are
 * unaffected.
 */
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
