"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { saveFile } from "@/lib/storage";
import { EMBEDDING_DIM } from "@/lib/voice/match";
import {
  deleteVoiceProfile,
  saveVoiceProfile,
  type VoiceProfileSummary,
} from "@/lib/voiceProfiles";

/**
 * Enrolment and deletion of the signed-in user's own voiceprint.
 *
 * Every action re-checks the session itself. A server action is a real endpoint
 * anyone can POST to, so rendering the page behind requireUser() decides who
 * sees the form, not who can call it. These only ever act on the caller's own
 * profile — there is deliberately no userId parameter, because a voiceprint is
 * biometric data and nobody should be able to enrol or delete on behalf of
 * someone else.
 */

/**
 * Enough speech to characterise a voice; below this, matching gets unreliable.
 *
 * Not exported: in a "use server" module every export must be an async function,
 * and exporting a constant makes the bundler discard the whole module's exports.
 */
// Raised from 4. Four windows is about six seconds of speech, and a profile
// built from that little has too much room to resemble whoever happens to be
// quiet — one such profile scores 0.86 against a window of near-silence, higher
// than any genuine match in the meeting it was measured against. With
// overlapping windows a proper enrolment yields well over twenty.
const MIN_ENROLL_WINDOWS = 12;

function parseEmbeddings(raw: string): number[][] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Could not read the voice samples");
  }
  if (!Array.isArray(parsed)) throw new Error("Could not read the voice samples");

  return parsed.map((v) => {
    if (!Array.isArray(v) || v.length !== EMBEDDING_DIM) {
      throw new Error("Voice samples were the wrong shape");
    }
    const nums = v.map(Number);
    if (nums.some((n) => !Number.isFinite(n))) {
      throw new Error("Voice samples contained invalid numbers");
    }
    return nums;
  });
}

export async function enrollVoice(
  formData: FormData,
): Promise<VoiceProfileSummary> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in");

  // Consent is the legal basis for holding a voiceprint at all, so it is
  // checked here and stamped on the row — not merely a checkbox in the UI.
  if (formData.get("consent") !== "1") {
    throw new Error("Consent is required to create a voice profile");
  }

  const embeddings = parseEmbeddings(String(formData.get("embeddings") ?? ""));
  if (embeddings.length < MIN_ENROLL_WINDOWS) {
    throw new Error(
      "That recording was too short or too quiet — please try again and speak for the full time",
    );
  }

  const model = String(formData.get("model") ?? "").trim();
  if (!model) throw new Error("Missing model identifier");

  // Keep the clip so voiceprints can be regenerated if the model changes.
  // Best-effort: failing to store audio should not cost the user their
  // enrolment, since the vectors are the part that actually matters.
  let clipPath: string | null = null;
  const clip = formData.get("clip");
  if (clip instanceof File && clip.size > 0) {
    try {
      const ext = (clip.name.split(".").pop() || "webm").toLowerCase();
      const bytes = Buffer.from(await clip.arrayBuffer());
      const saved = await saveFile("voiceprints", `${user.id}.${ext}`, bytes);
      clipPath = saved.relativePath;
    } catch (err) {
      console.error("[voice] Failed to store enrolment clip:", err);
    }
  }

  const profile = await saveVoiceProfile({
    userId: user.id,
    email: user.email,
    name: user.name,
    embeddings,
    model,
    clipPath,
  });

  revalidatePath("/profile/voice");
  return profile;
}

export async function removeVoiceProfile(): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not signed in");

  await deleteVoiceProfile(user.id);
  revalidatePath("/profile/voice");
}
