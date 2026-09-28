/**
 * Recover meetings broken by the old length limits.
 *
 *   node --env-file=.env.local scripts/backfill-long-meetings.mjs          # dry run
 *   node --env-file=.env.local scripts/backfill-long-meetings.mjs --apply
 *
 * Two populations, both created by limits that no longer exist:
 *
 *   too-large   Transcription refused the recording outright, because the whole
 *               file had to fit in the worker's heap. The audio is safe in
 *               storage and was never touched; only transcription never ran.
 *
 *   truncated   Completed meetings whose transcript exceeded the 45,000-character
 *               slice that used to be applied before the minutes were written.
 *               These look successful and are not: the minutes describe the
 *               first part of the meeting only, which is why every one of them
 *               reports no action items. The transcript itself is correct and
 *               complete, so re-analysing costs no transcription spend at all.
 *
 * Deliberately does not send email. Every one of these meetings already has
 * emailedAt set, and the pipeline checks it, so corrected minutes appear in MeetMate
 * without a second copy landing in anyone's inbox. Sending the corrected version
 * is a decision for a person, not a side effect of a backfill.
 *
 * Serial by design. These are the slowest jobs in the app; firing them off
 * together would put a queue of multi-hour transcriptions in flight at once.
 */
import { neon } from "@neondatabase/serverless";

const APPLY = process.argv.includes("--apply");
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice(7);

const APP_URL = process.env.APP_URL?.replace(/\/$/, "");
const sql = neon(process.env.DATABASE_URL);

/** Characters the old code sent to the model before cutting the rest off. */
const OLD_SLICE = 45000;

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

  const tooLarge = await sql`
    select id, title, status, error
    from meetings
    where recording_path is not null
      and status = 'failed'
      and error ilike '%too large to transcribe%'
    order by created_at desc`;

  const truncated = await sql`
    select id, title,
           length(transcript->>'fullText') as chars,
           jsonb_array_length(coalesce(minutes->'actionItems','[]'::jsonb)) as actions
    from meetings
    where status = 'completed'
      and transcript is not null
      and length(transcript->>'fullText') > ${OLD_SLICE}
    order by length(transcript->>'fullText') desc`;

  const wanted = (kind) => !ONLY || ONLY === kind;

  console.log(`\nRe-transcribe (recording intact, transcription never ran): ${tooLarge.length}`);
  for (const m of tooLarge) {
    console.log(`  ${m.id}  ${m.title}`);
  }

  console.log(`\nRe-analyse (transcript complete, minutes written from a slice): ${truncated.length}`);
  for (const m of truncated) {
    const lost = Math.round((1 - OLD_SLICE / Number(m.chars)) * 100);
    console.log(
      `  ${m.id}  ${String(m.chars).padStart(7)} chars  ~${String(lost).padStart(2)}% unseen  ${m.actions} action items  ${m.title}`,
    );
  }

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to act on these.");
    console.log("Add --only=truncated or --only=too-large to do one population.\n");
    return;
  }
  if (!APP_URL) {
    throw new Error("APP_URL is not set — needed to reach the reprocess endpoints");
  }

  // Clearing the transcript is what makes the pipeline transcribe again: its
  // resume guard deliberately skips transcription whenever one already exists,
  // so that a retry after a model timeout doesn't pay Deepgram twice.
  if (wanted("too-large")) {
    for (const m of tooLarge) {
      console.log(`\n[re-transcribe] ${m.id} ${m.title}`);
      await sql`
        update meetings
        set status = 'recorded', error = null, transcript = null,
            speaker_map = null, minutes = null,
            transcription_request_id = null, transcription_started_at = null
        where id = ${m.id}`;
      console.log("  queued — open the meeting in MeetMate to start processing");
    }
  }

  // Re-analysing needs the transcript kept: it is correct, and only the minutes
  // were written from a slice of it.
  if (wanted("truncated")) {
    for (const m of truncated) {
      console.log(`\n[re-analyse] ${m.id} ${m.title}`);
      await sql`update meetings set minutes = null, status = 'transcribed', error = null where id = ${m.id}`;
      console.log("  queued — open the meeting in MeetMate to regenerate its minutes");
    }
  }

  console.log(
    "\nDone. These are queued, not run: opening each meeting in MeetMate starts it,\n" +
      "which keeps the work attributable and lets you check one before doing the rest.\n",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
