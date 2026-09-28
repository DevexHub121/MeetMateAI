/**
 * Recompute every voiceprint under the enrolment-weighted rule.
 *
 *   node --env-file=.env.local scripts/rebuild-voiceprints.mjs          # dry run
 *   node --env-file=.env.local scripts/rebuild-voiceprints.mjs --apply
 *
 * Centroids used to be the mean of the 60 most recent samples. For a profile
 * that had been through many meetings that meant the 60 newest were all
 * meeting-adapted, so none of the recordings the person deliberately made still
 * contributed to their own voiceprint. One profile had drifted to a cosine of
 * 0.65 against its own enrolment.
 *
 * This keeps every enrolment sample and caps meeting samples at three per
 * enrolment sample, then trims the rest — the same rule addMeetingSamples now
 * applies going forward.
 *
 * NOT YET RUN AGAINST PRODUCTION, deliberately. Measured on the one meeting we
 * have ground truth for, rebuilding made that case worse rather than better:
 * the drifted profile scored 0.494 against another person's voice and the
 * rebuilt one scored 0.532 — which would have crossed the margin and named the
 * wrong person confidently, where before it was correctly refused.
 *
 * That measurement rests on five noisy windows, so it is weak evidence in both
 * directions; it is not a reason to believe the old centroids are better, only
 * a reason not to rewrite everyone's voiceprint on a hypothesis. Re-run the
 * identification with the new turn-based windowing first, then decide with
 * data worth deciding on.
 */
import { neon } from "@neondatabase/serverless";

const APPLY = process.argv.includes("--apply");
const MAX_SAMPLES = 60;
const ADAPTED_PER_ENROLLED = 3;
const sql = neon(process.env.DATABASE_URL);

const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const nrm = (a) => Math.sqrt(dot(a, a));
const cos = (a, b) => dot(a, b) / (nrm(a) * nrm(b) || 1);
const vec = (v) => (typeof v === "string" ? JSON.parse(v) : v);
function centroid(vs) {
  const mean = vs[0].map((_, i) => vs.reduce((s, v) => s + v[i], 0) / vs.length);
  const n = nrm(mean) || 1;
  return mean.map((x) => x / n);
}

for (const p of await sql`select id, name, email, embedding, sample_count from voice_profiles order by name`) {
  const enrolled = (await sql`
    select id, embedding from voice_samples
    where profile_id=${p.id} and source='enrollment' order by created_at`).map(r => ({ id: r.id, e: vec(r.embedding) }));
  const budget = Math.max(0, Math.min(
    MAX_SAMPLES - enrolled.length,
    enrolled.length > 0 ? enrolled.length * ADAPTED_PER_ENROLLED : MAX_SAMPLES,
  ));
  const adapted = budget === 0 ? [] : (await sql`
    select id, embedding from voice_samples
    where profile_id=${p.id} and source='meeting'
    order by created_at desc limit ${budget}`).map(r => ({ id: r.id, e: vec(r.embedding) }));

  const kept = [...enrolled, ...adapted];
  const total = (await sql`select count(*)::int n from voice_samples where profile_id=${p.id}`)[0].n;
  if (kept.length === 0) { console.log(`${p.name.padEnd(17)} no samples — skipped`); continue; }

  const next = centroid(kept.map(k => k.e));
  const moved = cos(vec(p.embedding), next);
  console.log(
    `${p.name.padEnd(17)} rows=${String(total).padStart(3)}  enrol=${String(enrolled.length).padStart(2)} + adapted=${String(adapted.length).padStart(2)}` +
    ` -> ${String(kept.length).padStart(2)} in centroid (was ${p.sample_count})   shift=${moved.toFixed(3)}`,
  );

  if (!APPLY) continue;
  await sql`update voice_profiles set embedding=${JSON.stringify(next)}, sample_count=${kept.length}, updated_at=now() where id=${p.id}`;
  const keep = kept.map(k => k.id);
  await sql`delete from voice_samples where profile_id=${p.id} and id <> all(${keep})`;
}
console.log(APPLY ? "\nApplied." : "\nDry run — re-run with --apply.");
