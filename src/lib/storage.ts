import { mkdir, writeFile, readFile, unlink, open } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Storage abstraction with two backends:
//   • DigitalOcean Spaces (S3-compatible) — used in production. App Platform's
//     local filesystem is ephemeral, so anything written to disk is lost on the
//     next deploy/restart; Spaces is durable.
//   • Local filesystem — fallback for local dev when Spaces env vars are unset.
//
// The "relativePath" returned by saveFile (e.g. "recordings/<uuid>.webm")
// doubles as the Spaces object key, so the value stored in the DB
// (recordingPath) is identical for both backends and callers never change.
//
// Required env vars to enable Spaces:
//   SPACES_KEY, SPACES_SECRET, SPACES_BUCKET, SPACES_REGION
//   SPACES_ENDPOINT (optional; defaults to https://<region>.digitaloceanspaces.com)

const STORAGE_ROOT = path.join(process.cwd(), "storage");

const SPACES_BUCKET = process.env.SPACES_BUCKET;
const SPACES_REGION = process.env.SPACES_REGION;
const SPACES_KEY = process.env.SPACES_KEY;
const SPACES_SECRET = process.env.SPACES_SECRET;
const SPACES_ENDPOINT =
  process.env.SPACES_ENDPOINT ??
  (SPACES_REGION ? `https://${SPACES_REGION}.digitaloceanspaces.com` : undefined);

const useSpaces = Boolean(
  SPACES_BUCKET && SPACES_REGION && SPACES_KEY && SPACES_SECRET,
);

let _s3: S3Client | null = null;
function s3(): S3Client {
  if (!_s3) {
    _s3 = new S3Client({
      region: SPACES_REGION!,
      endpoint: SPACES_ENDPOINT!,
      // Spaces uses path/virtual-hosted style like AWS; default works.
      credentials: {
        accessKeyId: SPACES_KEY!,
        secretAccessKey: SPACES_SECRET!,
      },
    });
  }
  return _s3;
}

const CONTENT_TYPES: Record<string, string> = {
  ".webm": "audio/webm",
  ".ogg": "audio/ogg",
  ".mp4": "audio/mp4",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

async function ensureDir(dir: string) {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

export async function saveFile(
  // "voiceprints" holds the short enrolment clips, kept so a voiceprint can be
  // regenerated if the embedding model changes without asking everyone to
  // re-record. Separate prefix from recordings so retention can differ.
  subdir: "recordings" | "voiceprints",
  originalName: string,
  data: Buffer,
): Promise<{ storedName: string; relativePath: string }> {
  const ext = path.extname(originalName);
  const storedName = `${randomUUID()}${ext}`;
  // POSIX-style key so it's consistent across OSes and valid as an S3 key.
  const relativePath = `${subdir}/${storedName}`;

  if (useSpaces) {
    await s3().send(
      new PutObjectCommand({
        Bucket: SPACES_BUCKET!,
        Key: relativePath,
        Body: data,
        ContentType: CONTENT_TYPES[ext.toLowerCase()] ?? "application/octet-stream",
        // Objects stay private; we stream them through our own authed routes.
        ACL: "private",
      }),
    );
    return { storedName, relativePath };
  }

  const dir = path.join(STORAGE_ROOT, subdir);
  await ensureDir(dir);
  await writeFile(path.join(dir, storedName), data);
  return { storedName, relativePath };
}

// True when Spaces is configured. Callers use this to decide between a direct
// browser→Spaces upload (no server body limit) and the local-disk fallback.
export function spacesEnabled(): boolean {
  return useSpaces;
}

// Mint a presigned PUT URL for a specific object key so the browser can upload
// straight to Spaces, bypassing the app server (and its proxy body-size limit /
// request timeout). Returns null when Spaces isn't configured (dev). We sign
// only the bucket/key (no ContentType/ACL) so the browser PUT needs no matching
// headers; objects are private by default in Spaces. Used to stream a recording
// up in parts as it's captured, so a crash mid-meeting can't lose everything.
export async function createPresignedPut(key: string): Promise<string | null> {
  if (!useSpaces) return null;
  return getSignedUrl(
    s3(),
    new PutObjectCommand({ Bucket: SPACES_BUCKET!, Key: key }),
    { expiresIn: 3600 },
  );
}

/**
 * Mint a short-lived presigned GET URL for a stored object.
 *
 * The counterpart to createPresignedPut, and it exists for the same reason in
 * reverse: so a third party can read one object directly from Spaces without
 * the bytes passing through this server. Deepgram takes a URL and fetches the
 * audio itself, which is what lets a three-hour recording be transcribed by a
 * worker that could never have held it in memory.
 *
 * Treat the result as a credential — anyone holding it can read the object
 * until it expires. Short expiry, and never logged.
 */
export async function createPresignedGet(
  key: string,
  expiresIn = 900,
): Promise<string | null> {
  if (!useSpaces) return null;
  return getSignedUrl(
    s3(),
    new GetObjectCommand({ Bucket: SPACES_BUCKET!, Key: key }),
    { expiresIn },
  );
}

/**
 * Size of a stored object in bytes, without reading it.
 *
 * Used to decide whether a recording is big enough to be worth transcribing
 * asynchronously. Deliberately size and not duration: `duration_seconds` is only
 * written by the browser recorder, so every note-taker meeting has it null —
 * including the ones this decision exists to route correctly.
 */
export async function storedFileSize(relativePath: string): Promise<number | null> {
  const safe = relativePath.normalize().replace(/^(\.\.(\/|\\|$))+/, "");
  try {
    if (useSpaces) {
      const head = await s3().send(
        new HeadObjectCommand({ Bucket: SPACES_BUCKET!, Key: safe }),
      );
      return head.ContentLength ?? null;
    }
    const { stat } = await import("fs/promises");
    return (await stat(path.join(STORAGE_ROOT, safe))).size;
  } catch {
    return null;
  }
}

async function streamToBuffer(body: unknown): Promise<Buffer> {
  // Node.js runtime: GetObject Body is a Readable stream.
  const stream = body as AsyncIterable<Uint8Array>;
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// ── Merging a streamed recording ────────────────────────────────────────────
//
// The browser uploads audio in ~20-second parts while recording, so a finished
// meeting is N small objects that have to become one file. The obvious way —
// read them all, Buffer.concat, upload — holds the entire recording in memory
// twice and makes N sequential round trips inside one request. Both costs grow
// with meeting length: a 75-minute recording is 226 parts, and this codebase
// has already had a worker OOM-killed by a ~140 MB buffer (see recall.ts).
//
// So the merge streams instead. Parts are fetched a few ahead (to hide latency,
// not to hoard bytes) and appended into a rolling window that is flushed to a
// multipart upload whenever it passes the 5 MB minimum S3 requires. Peak memory
// is the window plus the read-ahead — a few tens of MB at most — regardless of
// whether the meeting ran five minutes or two hours.

/** S3 requires every part except the last to be at least 5 MB. */
const MIN_MULTIPART_BYTES = 5 * 1024 * 1024;

/** How many source parts to fetch concurrently. Enough to stop N round trips
 *  being N latencies end to end; small enough that the bytes in flight stay
 *  bounded. */
const READ_AHEAD = 4;

/** Fetches keys in order, with a bounded look-ahead window. */
async function* readParts(keys: string[]): AsyncGenerator<Buffer> {
  const queue: Promise<Buffer>[] = [];
  let next = 0;
  const fill = () => {
    while (queue.length < READ_AHEAD && next < keys.length) {
      queue.push(readStoredFile(keys[next++]));
    }
  };
  fill();
  while (queue.length) {
    const buf = await queue.shift()!;
    fill();
    yield buf;
  }
}

/** Normalise whatever a source yields into a Buffer, without copying a Buffer. */
function asBuffer(chunk: Buffer | Uint8Array): Buffer {
  return Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
}

/**
 * Writes an arbitrary stream of chunks into one stored object, with peak memory
 * bounded by the 5 MB window rather than by the size of what is being written.
 *
 * Extracted from mergeStoredParts so that pulling a recording from a remote URL
 * gets the same treatment. The two differ only in where the bytes come from —
 * sibling parts in our own bucket, or a download from Recall — and the part that
 * matters, never accumulating the whole file, is identical for both.
 */
async function streamToStorage(
  subdir: "recordings" | "voiceprints",
  originalName: string,
  source: AsyncIterable<Buffer | Uint8Array>,
): Promise<{ storedName: string; relativePath: string }> {
  const ext = path.extname(originalName);
  const storedName = `${randomUUID()}${ext}`;
  const relativePath = `${subdir}/${storedName}`;
  const contentType =
    CONTENT_TYPES[ext.toLowerCase()] ?? "application/octet-stream";

  // Local dev: append to a file on disk. Same streaming shape, no S3 involved.
  if (!useSpaces) {
    const dir = path.join(STORAGE_ROOT, subdir);
    await ensureDir(dir);
    const target = path.join(dir, storedName);
    const handle = await open(target, "w");
    try {
      for await (const chunk of source) await handle.write(asBuffer(chunk));
    } finally {
      await handle.close();
    }
    return { storedName, relativePath };
  }

  const client = s3();
  const created = await client.send(
    new CreateMultipartUploadCommand({
      Bucket: SPACES_BUCKET!,
      Key: relativePath,
      ContentType: contentType,
      ACL: "private",
    }),
  );
  const uploadId = created.UploadId;
  if (!uploadId) throw new Error("Storage did not return an upload id");

  const done: { ETag: string; PartNumber: number }[] = [];
  let window: Buffer[] = [];
  let windowBytes = 0;
  let partNumber = 1;

  const flushWindow = async () => {
    if (windowBytes === 0) return;
    const body = Buffer.concat(window, windowBytes);
    window = [];
    windowBytes = 0;
    const res = await client.send(
      new UploadPartCommand({
        Bucket: SPACES_BUCKET!,
        Key: relativePath,
        UploadId: uploadId,
        PartNumber: partNumber,
        Body: body,
      }),
    );
    if (!res.ETag) throw new Error(`Storage did not acknowledge part ${partNumber}`);
    done.push({ ETag: res.ETag, PartNumber: partNumber });
    partNumber += 1;
  };

  try {
    for await (const chunk of source) {
      const buf = asBuffer(chunk);
      if (buf.byteLength === 0) continue;
      window.push(buf);
      windowBytes += buf.byteLength;
      if (windowBytes >= MIN_MULTIPART_BYTES) await flushWindow();
    }
    // Whatever is left becomes the final part, which may be under 5 MB.
    await flushWindow();

    if (done.length === 0) throw new Error("Nothing was written");

    await client.send(
      new CompleteMultipartUploadCommand({
        Bucket: SPACES_BUCKET!,
        Key: relativePath,
        UploadId: uploadId,
        MultipartUpload: { Parts: done },
      }),
    );
  } catch (err) {
    // An abandoned multipart upload keeps its uploaded parts and keeps billing
    // for them, invisibly — clean up before rethrowing.
    try {
      await client.send(
        new AbortMultipartUploadCommand({
          Bucket: SPACES_BUCKET!,
          Key: relativePath,
          UploadId: uploadId,
        }),
      );
    } catch {
      // Best effort; the original failure is the one worth reporting.
    }
    throw err;
  }

  return { storedName, relativePath };
}

/**
 * Concatenates already-stored parts into a single object, without ever holding
 * the whole recording in memory.
 *
 * Returns the same shape as saveFile so callers can treat them alike.
 */
export async function mergeStoredParts(
  partKeys: string[],
  subdir: "recordings",
  originalName: string,
): Promise<{ storedName: string; relativePath: string }> {
  if (partKeys.length === 0) throw new Error("No parts to merge");
  return streamToStorage(subdir, originalName, readParts(partKeys));
}

/** Iterate a fetch body, which is a web ReadableStream rather than a Node one. */
async function* readWebStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Copy a remote file into our own storage without ever holding it in memory.
 *
 * This replaces `Buffer.from(await res.arrayBuffer())`, which materialised the
 * whole download and then copied it again — two full copies of the recording in
 * the worker heap at once. That is how a 140 MB note-taker video got a worker
 * OOM-killed, and an OOM kill is not an exception: nothing unwinds, no status is
 * written, and the meeting sits on "transcribing" forever looking like it is
 * still working.
 *
 * The recording still lands in exactly the same place it always did — same
 * bucket, same key shape, same `recordingPath` on the row, same player. Only the
 * route the bytes take between the two ends has changed.
 */
export async function saveFileFromUrl(
  subdir: "recordings" | "voiceprints",
  originalName: string,
  url: string,
  opts: { timeoutMs?: number } = {},
): Promise<{ storedName: string; relativePath: string }> {
  // Generous, because this is a multi-hundred-MB download over someone else's
  // network — but not unbounded, because a hung fetch with no timeout is how a
  // job waits forever without failing.
  const res = await fetch(url, {
    signal: AbortSignal.timeout(opts.timeoutMs ?? 15 * 60 * 1000),
  });
  if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`);
  if (!res.body) throw new Error("download returned no body");

  const saved = await streamToStorage(
    subdir,
    originalName,
    readWebStream(res.body as ReadableStream<Uint8Array>),
  );
  return saved;
}

/**
 * Remove many stored objects in as few round trips as possible.
 *
 * The caller that matters is finalizing a recording: a three-hour meeting
 * uploads ~540 parts, and deleting them one `await` at a time took 35-55
 * seconds of a single server action — after the merge had already succeeded, so
 * every second of it was spent risking a timeout on work that was already done.
 * S3 takes up to 1000 keys per DeleteObjects call, which turns 540 round trips
 * into one.
 *
 * Best-effort, like deleteStoredFile: an orphaned part costs a fraction of a
 * cent, and is always preferable to failing a save that has otherwise worked.
 */
export async function deleteStoredFiles(relativePaths: string[]): Promise<void> {
  if (relativePaths.length === 0) return;
  const safe = relativePaths.map((p) =>
    p.normalize().replace(/^(\.\.(\/|\\|$))+/, ""),
  );

  if (!useSpaces) {
    await Promise.all(safe.map((p) => deleteStoredFile(p).catch(() => {})));
    return;
  }

  const BATCH = 1000;
  for (let i = 0; i < safe.length; i += BATCH) {
    try {
      await s3().send(
        new DeleteObjectsCommand({
          Bucket: SPACES_BUCKET!,
          Delete: {
            Objects: safe.slice(i, i + BATCH).map((Key) => ({ Key })),
            Quiet: true,
          },
        }),
      );
    } catch {
      // Best effort — see above.
    }
  }
}

// Best-effort removal of a stored recording (Spaces object or local file).
// Callers treat failures as non-fatal — an orphaned file is preferable to a
// delete action that errors out halfway.
export async function deleteStoredFile(relativePath: string): Promise<void> {
  const safe = relativePath.normalize().replace(/^(\.\.(\/|\\|$))+/, "");

  if (useSpaces) {
    await s3().send(
      new DeleteObjectCommand({ Bucket: SPACES_BUCKET!, Key: safe }),
    );
    return;
  }

  const fullPath = path.join(STORAGE_ROOT, safe);
  if (!fullPath.startsWith(STORAGE_ROOT)) {
    throw new Error("Invalid storage path");
  }
  if (existsSync(fullPath)) await unlink(fullPath);
}

export async function readStoredFile(relativePath: string): Promise<Buffer> {
  // Normalize and guard against path traversal in the key.
  const safe = relativePath.normalize().replace(/^(\.\.(\/|\\|$))+/, "");

  if (useSpaces) {
    const res = await s3().send(
      new GetObjectCommand({ Bucket: SPACES_BUCKET!, Key: safe }),
    );
    return streamToBuffer(res.Body);
  }

  const fullPath = path.join(STORAGE_ROOT, safe);
  if (!fullPath.startsWith(STORAGE_ROOT)) {
    throw new Error("Invalid storage path");
  }
  return readFile(fullPath);
}
