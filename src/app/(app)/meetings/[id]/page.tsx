import Link from "next/link";
import { notFound } from "next/navigation";
import { canViewMeeting, getMeeting } from "@/lib/meetings";
import { requireUser } from "@/lib/auth";
import { listEmployees } from "@/lib/employees";
import {
  applySpeakerMap,
  distinctSpeakers,
  namesFromConversation,
} from "@/lib/speakers";
import { StatusBadge } from "@/components/StatusBadge";
import { AutoRefresh } from "@/components/AutoRefresh";
import { formatIST } from "@/lib/datetime";
import {
  ACTIVE_BOT_STATUSES,
  latestBotSession,
  syncBotStatus,
} from "@/lib/botStatus";
import { recallEnabled, warmVideoUrl } from "@/lib/recall";
import { failIfStalled } from "@/lib/stalled";
import { RecordingSlotView } from "@/components/RecordingSession";
import { AIPipeline } from "./AIPipeline";
import { AudioImport } from "./AudioImport";
import { StartMeeting } from "./StartMeeting";
import { StopNoteTaker } from "./StopNoteTaker";
import { DeviceRecording } from "./DeviceRecording";
import { MinutesView } from "./MinutesView";
import { SpeakerMapping } from "./SpeakerMapping";
import { VoiceIdentify } from "./VoiceIdentify";
import { hasVoiceWindows } from "../voiceActions";
import { TitleActions } from "./TitleActions";
import { TranscriptView } from "./TranscriptView";
import { RecordingMedia } from "./RecordingMedia";
import { MeetingTabs, type MeetingTab } from "./MeetingTabs";
import { RestartProcessing } from "./RestartProcessing";
import { AddParticipants } from "./AddParticipants";
import { reprocessMeeting } from "../actions";

type Person = { name: string; email: string | null };

export const dynamic = "force-dynamic";

export default async function MeetingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();

  // Started here, awaited much further down. It depends on nothing but the id,
  // so running it alongside the meeting fetch costs nothing, where awaiting it
  // in place would add a serial database round-trip to every page view. The
  // catch keeps a failure from taking the page down with it — the worst case is
  // a missing video tab, and it also stops an unhandled rejection if the render
  // bails at notFound() before this is ever read.
  const botSession = latestBotSession(id).catch(() => null);

  let meeting = await getMeeting(id);
  if (!meeting || !canViewMeeting(meeting, user)) notFound();

  // AI note-taker (Recall bot) live state, before its recording lands and the
  // normal pipeline takes over.
  //
  // Read through syncBotStatus rather than straight off the row: the stored
  // value is only as fresh as the last webhook we were sent, and which webhooks
  // Recall sends is dashboard configuration outside this repo. See botStatus.ts.
  //
  // Runs before anything is derived from the row, because it can *change* the
  // row: when the bot has finished, this is the call that pulls the recording in.
  // Deriving hasRecording first would render one frame still offering to start a
  // meeting whose audio had just arrived.
  const botStatus = await syncBotStatus(meeting);
  if (botStatus === "done" && !meeting.recordingPath) {
    meeting = (await getMeeting(id)) ?? meeting;
  }

  // A processing run that died without saying so still reads as "analyzing"
  // forever. An OOM kill runs no catch block and a missing transcription
  // callback never arrives, so a deadline is the only thing that can tell those
  // apart from work still in progress. Checked here, alongside the bot sync,
  // because this is where someone comes to find out what happened.
  meeting = await failIfStalled(meeting);

  const hasRecording = Boolean(meeting.recordingPath);
  const processing =
    meeting.status === "recorded" ||
    meeting.status === "transcribing" ||
    meeting.status === "transcribed" ||
    meeting.status === "analyzing";
  const isScheduled = meeting.status === "scheduled" && !hasRecording;
  const invitees = meeting.invitees ?? [];

  const botActive =
    !hasRecording &&
    Boolean(meeting.meetingUrl) &&
    ACTIVE_BOT_STATUSES.includes(botStatus ?? "");
  const botFailed = !hasRecording && botStatus === "join_failed";
  const botLabel =
    botStatus === "recording"
      ? "recording the meeting"
      : botStatus === "in_call"
        ? "in the call"
        : "joining the call";

  // Offer to dispatch a note-taker whenever there's no recording and none is
  // already on its way. Also covers retrying after a failed join, and adding one
  // to a meeting that was created without a Meet link at all.
  //
  // This is also what "starting" a meeting means when it's true: the bot is the
  // whole mechanism, and recording through the browser drops to a secondary
  // choice for meetings held in a room. When it's false — Recall isn't
  // configured — the browser recorder is the only way to capture anything, so
  // it stays where it is.
  const canSendNoteTaker = recallEnabled() && !hasRecording && !botActive;

  // Whether to offer the video tab. Only meetings a bot attended have one —
  // a phone or browser recording is audio and nothing else.
  //
  // This is deliberately "a bot recorded this", not "a video exists": knowing
  // the latter means a round-trip to Recall, and paying for that on every
  // render of every completed meeting to grey out one tab is a bad trade. The
  // player handles the miss when it happens.
  const session = await botSession;
  const hasVideo = hasRecording && recallEnabled() && Boolean(session);

  // Resolve the presigned video URL now, without waiting for it.
  //
  // The first video request otherwise pays ~1.1s to Recall before a single byte
  // moves, which is dead time the viewer reads as "the video is slow". Warming
  // the cache while they are still looking at the page makes the Video tab hit
  // a URL that is already there. Not awaited, so it adds nothing to this render,
  // and cached for six hours per bot, so it is at most one call per bot per
  // afternoon rather than one per page view.
  if (hasVideo && session) void warmVideoUrl(session.botId);

  // Speaker mapping is available once we have a transcript. Offer this meeting's
  // participants (invitees) to map speakers to — NOT the whole employee
  // directory. Only when the meeting had no participants do we fall back to the
  // full directory so mapping is still possible.
  const speakers = distinctSpeakers(meeting.transcript);
  const showSpeakerMapping =
    speakers.length > 0 &&
    (meeting.status === "completed" || meeting.status === "failed");
  let people: Person[] = [];
  let voiceWindowsReady = false;
  if (showSpeakerMapping) {
    const byEmail = new Map<string, Person>();
    const byName = new Map<string, Person>();
    const add = (p: Person) => {
      const key = p.email?.toLowerCase();
      if (key) {
        if (!byEmail.has(key)) byEmail.set(key, p);
      } else if (!byName.has(p.name)) {
        byName.set(p.name, p);
      }
    };

    if (invitees.length > 0) {
      invitees.forEach((i) => add({ name: i.name, email: i.email || null }));
    } else {
      const employees = await listEmployees();
      employees
        .filter((e) => e.active)
        .forEach((e) => add({ name: e.name, email: e.email }));
    }

    // Also offer names actually mentioned in the conversation (self-intros /
    // who's addressed) — useful when a speaker wasn't in the invitee list.
    namesFromConversation(meeting.transcript).forEach((name) =>
      add({ name, email: null }),
    );

    people = [...byEmail.values(), ...byName.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    );

    // Whether this meeting already has voice vectors, so the panel can offer a
    // cheap re-match instead of decoding the whole recording again.
    voiceWindowsReady = await hasVoiceWindows(id);
  }

  // Show the transcript with mapped names ("Priya") rather than raw diarization
  // labels ("Speaker 0") wherever the user has assigned them.
  const transcript = meeting.transcript
    ? applySpeakerMap(meeting.transcript, meeting.speakerMap ?? null)
    : null;
  const hasTranscript = Boolean(
    transcript?.utterances?.length || transcript?.fullText?.trim(),
  );

  // People can be added right up until the minutes are written, which is the
  // moment the list stops being a guest list and starts being a record. That
  // window covers the whole meeting: recording leaves the status on "ready"
  // until the audio is saved, so "during" and "before" are the same state here.
  // Read after the bot sync above, so it reflects the status the page renders.
  const canAddPeople =
    meeting.type === "internal" && meeting.status !== "completed";

  // The directory behind the picker. Fetched only when the control is on the
  // page — a completed meeting has no reason to pull 40 rows it won't show.
  const addableEmployees = canAddPeople
    ? (await listEmployees()).filter((e) => e.active)
    : [];

  // Minutes, transcript and speaker mapping used to stack as one long scroll.
  // Group them into tabs instead — only the ones that actually have content.
  const tabs: MeetingTab[] = [];
  if (meeting.status === "completed" && meeting.minutes) {
    tabs.push({
      id: "minutes",
      label: "Minutes",
      content: (
        <MinutesView
          minutes={meeting.minutes}
          title={meeting.title}
          meetingId={id}
          tasksSent={Boolean(meeting.tasksSentAt)}
          isClient={meeting.type === "client"}
        />
      ),
    });
  }
  if (hasTranscript && transcript) {
    tabs.push({
      id: "transcript",
      label: "Transcript",
      content: (
        <section className="card p-5">
          <TranscriptView transcript={transcript} title={meeting.title} />
        </section>
      ),
    });
  }
  if (showSpeakerMapping) {
    tabs.push({
      id: "speakers",
      label: "Speakers",
      badge: speakers.length,
      content: (
        <>
          <SpeakerMapping
            meetingId={id}
            speakers={speakers}
            people={people}
            speakerMap={meeting.speakerMap ?? null}
            busy={meeting.status !== "completed"}
          />
          <VoiceIdentify
            meetingId={id}
            hasWindows={voiceWindowsReady}
            // Windows are cut inside these, so every speaker gets some — see
            // windowsInTurns. Timings only; no text leaves the server here.
            turns={(meeting.transcript?.utterances ?? []).map((u) => ({
              speaker: u.speaker,
              start: u.start,
              end: u.end,
            }))}
          />
        </>
      ),
    });
  }

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/meetings"
        className="mb-4 inline-block text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-heading)]"
      >
        ← Back to meetings
      </Link>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <TitleActions meetingId={id} title={meeting.title} />
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            {formatIST(meeting.meetingDate ?? meeting.createdAt)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
              meeting.type === "client"
                ? "bg-[var(--color-elevated)] text-[var(--color-heading)] ring-[var(--color-border)]"
                : "bg-[var(--color-muted-surface)] text-[var(--color-text-secondary)] ring-[var(--color-border)]"
            }`}
          >
            {meeting.type === "client" ? "Client" : "Internal"}
          </span>
          <StatusBadge status={meeting.status} />
        </div>
      </div>

      {/* Client meeting → show the client name instead of a participant list. */}
      {meeting.type === "client" && (
        <div className="card mb-6 p-5">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            Client
          </h2>
          <p className="text-sm text-[var(--color-text-primary)]">
            {meeting.clientName ? (
              <span className="font-medium text-[var(--color-heading)]">
                {meeting.clientName}
              </span>
            ) : (
              <span className="text-[var(--color-text-muted)]">
                Client meeting — no client name set
              </span>
            )}
          </p>
          <p className="mt-2 text-xs text-[var(--color-text-muted)]">
            Summary-only minutes — no action items or tasks.
          </p>
        </div>
      )}

      {/* Participants — internal meetings only.
          Rendered even with nobody on the list, because this is where you add
          them: a meeting started without a participant list is exactly the one
          that needs somewhere to put the people who walk in. */}
      {meeting.type === "internal" && (invitees.length > 0 || canAddPeople) && (
        <div className="card mb-6 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
              Participants
            </h2>
            {meeting.emailedAt ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
                ✓ Minutes emailed
              </span>
            ) : meeting.status === "completed" ? (
              <span className="text-xs text-[var(--color-text-muted)]">
                Minutes email pending
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {invitees.map((p, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-elevated)] px-3 py-1 text-sm text-[var(--color-text-secondary)]"
              >
                <span className="font-medium text-[var(--color-heading)]">
                  {p.name}
                </span>
                {p.email && (
                  <span className="text-[var(--color-text-muted)]">
                    · {p.email}
                  </span>
                )}
              </span>
            ))}
            {invitees.length === 0 && (
              <span className="text-sm text-[var(--color-text-muted)]">
                Nobody added yet.
              </span>
            )}
          </div>
          {canAddPeople && (
            <AddParticipants
              meetingId={id}
              employees={addableEmployees.map((e) => ({
                id: e.id,
                name: e.name,
                // A synced employee can have no email. Still addable — they
                // were in the room — they just won't receive the minutes.
                email: e.email ?? "",
                position: e.position,
              }))}
              existing={invitees.map((p) =>
                (p.email?.trim() || p.name.trim()).toLowerCase(),
              )}
            />
          )}
        </div>
      )}

      {/* Scheduled meeting → banner above the recorder. */}
      {isScheduled && (
        <div className="card mb-6 border-violet-500/30 bg-violet-500/10 p-5">
          <h2 className="text-sm font-semibold text-violet-200">
            Scheduled for {formatIST(meeting.meetingDate ?? meeting.createdAt)}
          </h2>
          <p className="mt-1 text-sm text-violet-300/80">
            When everyone&apos;s ready, start it below.
          </p>
        </div>
      )}

      {/* AI note-taker in the call → live banner, no manual recorder. */}
      {botActive && (
        <>
          <AutoRefresh />
          <div className="card mb-6 border-violet-500/30 bg-violet-500/10 p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-violet-200">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-violet-300" />
                  MeetMate is {botLabel}
                </h2>
                <p className="mt-1 text-sm text-violet-300/80">
                  It leaves on its own a couple of seconds after the last person
                  does. The transcript and minutes appear here automatically.
                </p>
              </div>
              <StopNoteTaker meetingId={id} />
            </div>
          </div>
        </>
      )}

      {/* No recording and no active bot → record live, or import a file/URL. */}
      {!hasRecording && !botActive && (
        <div className="space-y-4">
          {botFailed && (
            <div className="card border-amber-500/30 bg-amber-500/10 p-5">
              <h2 className="text-sm font-semibold text-amber-200">
                The note-taker couldn&apos;t join
              </h2>
              <p className="mt-1 text-sm text-amber-300/80">
                {meeting.error ??
                  "Recall couldn't join the Google Meet. Record it manually below or try again."}
              </p>
            </div>
          )}
          {canSendNoteTaker ? (
            <>
              <StartMeeting
                meetingId={id}
                meetingUrl={meeting.meetingUrl}
                retry={botFailed}
              />
              <DeviceRecording meetingId={id}>
                <RecordingSlotView
                  meetingId={id}
                  meetingType={meeting.type}
                  canSendNoteTaker
                />
              </DeviceRecording>
            </>
          ) : (
            <RecordingSlotView meetingId={id} meetingType={meeting.type} />
          )}
          <AudioImport meetingId={id} />
        </div>
      )}

      {/* Recording exists → audio player + processing / minutes / error. */}
      {hasRecording && (
        <div className="space-y-6">
          <div className="card p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-baseline gap-2.5">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                  Recording
                </h2>
                {meeting.durationSeconds && (
                  <span className="text-xs text-[var(--color-text-muted)]">
                    {formatDuration(meeting.durationSeconds)}
                  </span>
                )}
              </div>
              {/* Same route as the player, with ?download=1 flipping the
                  Content-Disposition to attachment. `download` alone wouldn't
                  do it — the attribute is ignored on responses the browser
                  can play inline. */}
              <a
                href={`/api/recording/${id}?download=1`}
                download
                className="btn-secondary shrink-0 px-3 py-1.5 text-sm"
              >
                <DownloadIcon />
                Download audio
              </a>
            </div>
            <RecordingMedia
              audioSrc={`/api/recording/${id}`}
              videoSrc={hasVideo ? `/api/recording/${id}/video` : undefined}
              fallbackDuration={meeting.durationSeconds}
            />
          </div>

          {processing && (
            <>
              <AutoRefresh />
              <AIPipeline status={meeting.status} />
              {/* Offered unconditionally rather than after some timeout,
                  because nothing on the row records when processing began —
                  and a quiet link costs a reader nothing while the pipeline is
                  genuinely running. */}
              <RestartProcessing meetingId={id} />
            </>
          )}

          {meeting.status === "failed" && (
            <div className="card border-red-500/30 bg-red-500/10 p-5">
              <h2 className="text-sm font-semibold text-red-300">
                Processing failed
              </h2>
              <p className="mt-1 text-sm text-red-300/80">
                {meeting.error ?? "Something went wrong."}
              </p>
              <form
                action={async () => {
                  "use server";
                  await reprocessMeeting(id);
                }}
                className="mt-3"
              >
                <button
                  type="submit"
                  className="rounded-lg border border-red-500/40 bg-red-500/15 px-3 py-1.5 text-sm font-medium text-red-200 transition-colors hover:bg-red-500/25"
                >
                  Retry
                </button>
              </form>
            </div>
          )}

          <MeetingTabs tabs={tabs} />
        </div>
      )}
    </div>
  );
}

function DownloadIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3v12" />
      <path d="M7 12l5 5 5-5" />
      <path d="M4 20h16" />
    </svg>
  );
}

function formatDuration(seconds: string): string {
  const s = Number(seconds);
  if (!Number.isFinite(s)) return "";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}
