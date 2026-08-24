import { mkdir, writeFile, readFile, unlink, open } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
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
  subdir: "recordings",
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
      for await (const buf of readParts(partKeys)) await handle.write(buf);
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
    for await (const buf of readParts(partKeys)) {
      window.push(buf);
      windowBytes += buf.byteLength;
      if (windowBytes >= MIN_MULTIPART_BYTES) await flushWindow();
    }
    // Whatever is left becomes the final part, which may be under 5 MB.
    await flushWindow();

    if (done.length === 0) throw new Error("All parts were empty");

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
