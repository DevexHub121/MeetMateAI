import { requireUser } from "@/lib/auth";
import { assessVoiceProfile, getVoiceProfile } from "@/lib/voiceProfiles";
import { VoiceEnrollment } from "./VoiceEnrollment";
import { QualityCard } from "./QualityCard";

/**
 * A person's own voice profile.
 *
 * Deliberately NOT under /settings: that route is superadmin-only at the page,
 * the nav and every action, because it holds instance-wide configuration. This
 * is per-user data that each person manages for themselves, so it needs its own
 * route with an ordinary requireUser() gate. The actions re-check the session
 * and only ever touch the caller's own row.
 */
export const dynamic = "force-dynamic";

export default async function VoiceProfilePage() {
  const user = await requireUser();
  const [profile, quality] = await Promise.all([
    getVoiceProfile(user.id),
    // Scored from the stored samples rather than saved at enrolment, so it
    // reflects what the profile holds now and works for profiles recorded
    // before any of this existed.
    assessVoiceProfile(user.id).catch(() => null),
  ]);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-[var(--color-heading)]">
          Voice profile
        </h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Record a short sample once, and MeetMate can recognise your voice in
          meetings — so minutes and action items carry your name instead of
          &ldquo;Speaker 1&rdquo;.
        </p>
      </div>

      <div className="card p-6">
        <VoiceEnrollment initial={profile} />
      </div>

      {profile && quality && (
        <div className="mt-4">
          <QualityCard report={quality} />
        </div>
      )}

      <div className="mt-4 space-y-1 text-xs text-[var(--color-text-muted)]">
        <p>
          Your voiceprint is a list of numbers describing your voice — it cannot
          be played back or turned into audio. Nothing is used to train any
          model.
        </p>
        <p>
          Only people invited to a meeting are compared against it, and when
          MeetMate isn&apos;t confident it leaves the speaker unnamed rather than
          guessing.
        </p>
      </div>
    </div>
  );
}
