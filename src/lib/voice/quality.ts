/**
 * Scoring an enrolment, so a bad one is caught at the microphone rather than in
 * a meeting three weeks later.
 *
 * Every threshold here is calibrated against the profiles actually in the
 * database rather than chosen for looking round. Measured across six real
 * enrolments, samples sit between 0.70 and 0.87 from their own centroid.
 *
 * The interesting one is that consistency can be too HIGH. One profile scored
 * 0.985 — nearly identical samples — and it is the same profile that matches a
 * window of near-silence at 0.86, better than any genuine match in the meeting
 * it was measured against. A real voice moves: pitch, pace and loudness change
 * from sentence to sentence, and samples that barely differ are usually not
 * speech at all but a steady room hum. So consistency is scored as a band, not
 * a maximum.
 *
 * Pure and dependency-free, so the numbers can be tested without a microphone.
 */

export type EnrollmentSignals = {
  /** How many windows the enrolment produced. */
  samples: number;
  /** Mean cosine of each sample to their centroid. */
  tightness: number;
  /** Samples far enough from the centroid to look like something else. */
  outliers: number;
  /** The closest OTHER enrolled person, when there is one to compare against. */
  nearestOther?: { name: string; score: number } | null;
  /** Seconds of detected speech, when the enrolment was just recorded. */
  spokenSeconds?: number;
};

export type QualityIssue = {
  key: string;
  /** What is wrong, in the reader's terms. */
  title: string;
  /** What to do differently next time. */
  advice: string;
  severity: "warn" | "serious";
};

export type QualityReport = {
  score: number;
  grade: "excellent" | "good" | "weak" | "redo";
  headline: string;
  issues: QualityIssue[];
};

/** Below this a sample is not a variation of the voice, it is something else. */
const OUTLIER_AT = 0.5;

/** Where genuine enrolments sit. Outside it in either direction is a problem. */
const TIGHT_LOW = 0.68;
const TIGHT_HIGH = 0.93;

/** Two people should not sound this alike. Observed on a duplicate: 0.51. */
const CONFUSABLE_AT = 0.45;

export function scoreEnrollment(signals: EnrollmentSignals): QualityReport {
  const { samples, tightness, outliers, nearestOther, spokenSeconds } = signals;
  const issues: QualityIssue[] = [];

  // ── How much of you there is (0-30) ──────────────────────────────────────
  // A centroid over few samples is a guess about a voice, not a summary of it.
  const coverage = Math.max(0, Math.min(30, ((samples - 6) / 24) * 30));
  if (samples < 12) {
    issues.push({
      key: "too-few",
      severity: "serious",
      title: `Only ${samples} usable ${samples === 1 ? "piece" : "pieces"} of speech`,
      advice:
        "Not enough to recognise you reliably. The recording session is longer than it used to be, so recording again will produce two or three times as much — most profiles from the older version land here.",
    });
  } else if (samples < 20) {
    issues.push({
      key: "thin",
      severity: "warn",
      title: "A little thin",
      advice: "Talking for longer in the second half would make this steadier.",
    });
  }

  if (spokenSeconds !== undefined && spokenSeconds < 20) {
    issues.push({
      key: "short",
      severity: spokenSeconds < 15 ? "serious" : "warn",
      title: `Only ${spokenSeconds.toFixed(0)}s of actual speech`,
      advice:
        "Keep talking until the timer stops — it is fine to be boring, it is the sound of your voice that matters.",
    });
  }

  // ── Whether it sounds like one person (0-40) ─────────────────────────────
  let consistency: number;
  if (tightness < TIGHT_LOW) {
    consistency = Math.max(0, (tightness / TIGHT_LOW) * 25);
    issues.push({
      key: "inconsistent",
      severity: tightness < 0.6 ? "serious" : "warn",
      title: "The recording isn't consistent",
      advice:
        "Usually background noise, someone else talking nearby, or moving around while recording. Somewhere quieter, staying still, will fix it.",
    });
  } else if (tightness > TIGHT_HIGH) {
    // Too uniform to be speech. This is the silence detector.
    consistency = 20;
    issues.push({
      key: "too-uniform",
      severity: "serious",
      title: "This doesn't sound like varied speech",
      advice:
        "Nearly every moment is identical, which usually means the microphone picked up room noise rather than your voice. Move closer, check the right input device is selected, and speak up.",
    });
  } else {
    consistency = 40;
  }

  if (outliers > 0) {
    const penalty = Math.min(15, outliers * 6);
    consistency = Math.max(0, consistency - penalty);
    issues.push({
      key: "outliers",
      severity: outliers > 2 ? "serious" : "warn",
      title: `${outliers} ${outliers === 1 ? "piece doesn't" : "pieces don't"} sound like you`,
      advice:
        "Something else got recorded — a second voice, a notification, a door. Record again with the room to yourself.",
    });
  }

  // ── Whether it is distinguishable from everyone else (0-30) ──────────────
  let distinct = 30;
  if (nearestOther && nearestOther.score >= CONFUSABLE_AT) {
    distinct = Math.max(0, 30 - (nearestOther.score - CONFUSABLE_AT) * 120);
    issues.push({
      key: "confusable",
      severity: nearestOther.score >= 0.55 ? "serious" : "warn",
      title: `Close to ${nearestOther.name}'s voice`,
      advice:
        `Echo may confuse the two of you. If ${nearestOther.name} was in the room while you recorded, or this is a second profile for the same person, record again alone.`,
    });
  }

  const score = Math.round(coverage + consistency + distinct);

  // A serious problem caps the grade regardless of the arithmetic. Points
  // average away exactly the thing worth acting on: a profile can score well on
  // length and distinctness while being made of room noise, and calling that
  // "good" because two thirds of it is fine helps nobody.
  const serious = issues.filter((i) => i.severity === "serious").length;
  const byScore =
    score >= 80 ? "excellent" : score >= 65 ? "good" : score >= 45 ? "weak" : "redo";
  const grade: QualityReport["grade"] =
    serious >= 2 ? "redo" : serious === 1 && byScore !== "redo" ? "weak" : byScore;

  const headline =
    grade === "excellent"
      ? "Strong voice profile — nothing to do."
      : grade === "good"
        ? "Good enough to match with."
        : grade === "weak"
          ? "Usable, but it will miss you sometimes. Worth recording again."
          : "Too weak to match reliably — please record again.";

  return { score, grade, headline, issues };
}
