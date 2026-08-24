import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The images the bot shows as its camera feed while it's in a call.
 *
 * Without this the note-taker is a nameless black rectangle in the participant
 * grid, which is the single most common "what is that thing in our meeting"
 * question. Two states, because Recall distinguishes them and the difference is
 * worth showing a room: whether it is actually recording.
 *
 * The JPEGs are committed, built by scripts/build-notetaker-tile.mjs. See that
 * file for why they aren't rendered on demand. Recall's constraints: JPEG only,
 * 16:9, 1280x720, under 1.3 MB, and the base64 goes in raw — a data: URI prefix
 * is rejected.
 */

const TILE_DIR = join(process.cwd(), "public", "notetaker");

export type VideoOutput = {
  in_call_recording: { kind: "jpeg"; b64_data: string };
  in_call_not_recording: { kind: "jpeg"; b64_data: string };
};

/**
 * Read once per process and hold on to it. These are ~25 KB each and never
 * change between deploys, so the alternative is re-reading the same two files
 * from disk on every bot dispatch to get the same answer.
 */
let cached: VideoOutput | null | undefined;

function readTile(name: string): string {
  const buf = readFileSync(join(TILE_DIR, `${name}.jpg`));
  // Guard the one failure that would otherwise reach Recall as a confusing
  // validation error: a file that isn't a JPEG. FF D8 FF is the SOI marker.
  if (buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) {
    throw new Error(`${name}.jpg is not a JPEG`);
  }
  if (buf.byteLength > 1.3 * 1024 * 1024) {
    throw new Error(`${name}.jpg is ${(buf.byteLength / 1024 / 1024).toFixed(2)} MB, over Recall's 1.3 MB limit`);
  }
  return buf.toString("base64");
}

/**
 * Returns null if the tiles can't be loaded. Callers treat the camera feed as a
 * nicety: a missing image should never be the reason a meeting doesn't get
 * recorded.
 */
export function notetakerVideoOutput(): VideoOutput | null {
  if (cached !== undefined) return cached;
  try {
    cached = {
      in_call_recording: { kind: "jpeg", b64_data: readTile("recording") },
      in_call_not_recording: { kind: "jpeg", b64_data: readTile("idle") },
    };
  } catch (err) {
    console.warn("[recall] note-taker camera tile unavailable:", err);
    cached = null;
  }
  return cached;
}
