/**
 * Who attended, and who was merely talked about.
 *
 * These are different questions and were being answered by the same guess. The
 * model was asked to infer attendees from the transcript, so a meeting whose
 * four participants were Ankita, Karishma, Shivam and Saniya went out with
 * "Attendees: Rahul, Neha" — two names that were said aloud during the call.
 * The minutes then credited people who may not have been in the room, to an
 * audience of four who were.
 *
 * The invite list is the answer to "who attended": someone was deliberately
 * added to this meeting, which is a fact, whereas a name heard in conversation
 * is an inference about a voice. Names the transcript mentions are still worth
 * showing — they are usually the people being discussed — but as context,
 * clearly separate from the attendee list.
 *
 * Pure and dependency-free so both the real and the key-free minutes paths can
 * share it, and so the rules are directly testable.
 */

/** Compare names ignoring case, punctuation and extra spacing. */
function norm(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ");
}

const firstOf = (name: string) => norm(name).split(" ")[0] ?? "";

/**
 * Labels MeetMate writes into the transcript itself, which are not people.
 *
 * `applySpeakerMap` rewrites every turn to start with whatever the speaker map
 * says, so an unidentified speaker stays "Speaker 3" and a client-meeting role
 * becomes "Client" or the host's name. The minutes model then reads those back
 * out of the transcript and reports them as people who were mentioned — which
 * is how "Client" and "Speaker 0" ended up listed alongside real colleagues.
 *
 * They are our own labels coming back to us, so they are filtered in code
 * rather than argued about in a prompt.
 */
const LABEL_PATTERNS = [
  /^speakers?\s*\d+$/i,
  /^(the\s+)?client$/i,
  /^(the\s+)?host$/i,
  /^guest\s*\d*$/i,
  /^unassigned$/i,
  /^unknown$/i,
  /^participants?\s*\d*$/i,
];

/** True when a "name" is one of MeetMate's own placeholders rather than a person. */
export function isRoleLabel(name: string, extra: readonly string[] = []): boolean {
  const k = norm(name);
  if (!k) return true;
  if (LABEL_PATTERNS.some((re) => re.test(name.trim()))) return true;
  return extra.some((e) => norm(e) === k);
}

/**
 * Is this name actually supported by what was said?
 *
 * The guard against a model returning a name from nowhere. It has a specific
 * cause worth naming: the speaker-identification prompt used to carry
 * `{"Speaker 0": "Rahul", "Speaker 1": "Neha"}` as its output example, and when
 * the model could not identify anyone it copied the example — so seventeen
 * speaker assignments across the database named two people who are never
 * spoken of in any of those meetings, and the minutes then credited them.
 *
 * The prompt no longer contains names, but a prompt is a request and this is a
 * check. A name nobody said is not evidence of anything, whatever produced it.
 */
export function isNameEvidenced(name: string, transcriptText: string): boolean {
  const haystack = norm(transcriptText);
  const k = norm(name);
  if (!k || !haystack) return false;
  // Word-boundary match, so "Ana" does not match "analysis".
  const words = new Set(haystack.split(" "));
  return k.split(" ").every((part) => words.has(part));
}

/**
 * The attendee list.
 *
 * The people invited, when there are any. Only when a meeting has no invite
 * list at all — most of the older recordings — do we fall back to what the
 * transcript suggested, because something is better than an empty section.
 */
export function resolveAttendees(
  participants: readonly string[],
  inferred: readonly string[],
  opts: { roleLabels?: readonly string[] } = {},
): string[] {
  const named = participants.map((p) => p.trim()).filter(Boolean);
  if (named.length > 0) return dedupe(named);
  // No invite list, so the transcript is all we have — but "Speaker 2" is not
  // an attendee's name, it is the absence of one.
  return dedupe(
    inferred
      .map((n) => n.trim())
      .filter(Boolean)
      .filter((n) => !isRoleLabel(n, opts.roleLabels ?? [])),
  );
}

/**
 * Names the conversation mentioned that are not already attendees.
 *
 * A participant who gets talked about by name shouldn't appear twice — once as
 * an attendee and again as a "mentioned" name — so anyone matching the invite
 * list is removed. Matching is loose on purpose: an invite list carries full
 * names while people are called by their first name out loud, so "Ankita"
 * spoken in the room is the "Ankita Sharma" on the list.
 */
export function mentionedOnly(
  detected: readonly string[],
  participants: readonly string[],
  opts: { roleLabels?: readonly string[]; transcriptText?: string } = {},
): string[] {
  const full = new Set(participants.map(norm).filter(Boolean));
  const first = new Set(participants.map(firstOf).filter(Boolean));

  return dedupe(
    detected
      .map((n) => n.trim())
      .filter(Boolean)
      .filter((n) => {
        const k = norm(n);
        if (!k) return false;
        // Our own placeholders, not people.
        if (isRoleLabel(n, opts.roleLabels ?? [])) return false;
        // Nobody said this name. Whatever produced it, it is not a mention.
        if (
          opts.transcriptText !== undefined &&
          !isNameEvidenced(n, opts.transcriptText)
        ) {
          return false;
        }
        if (full.has(k)) return false;
        // "Ankita" said aloud is the "Ankita Sharma" on the invite list.
        if (first.has(k)) return false;
        // And a full name spoken aloud matching an invited first name.
        if (first.has(firstOf(n))) return false;
        return true;
      }),
  );
}

/** Case-insensitive de-duplication that keeps the first spelling seen. */
function dedupe(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const k = norm(n);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(n);
  }
  return out;
}
