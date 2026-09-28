"use client";

import dynamic from "next/dynamic";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { MeetingType } from "@/db/schema";

/**
 * Keeps a recording alive while you walk around the rest of Echo.
 *
 * The recorder used to live on the meeting page, which meant it died the moment
 * you left it: React unmounts the component, the unmount teardown stops every
 * track, and the audio since the last flush is gone. So "let me check what we
 * decided in last week's meeting" cost you the recording of this one — and the
 * only safe advice was don't touch anything until it ends, which is not advice
 * anybody follows for an hour.
 *
 * The fix is to move where the recorder is *mounted*, not what it does. One
 * instance lives up in the app layout, which Next keeps mounted across every
 * navigation inside the layout, and its UI is portalled down into whatever page
 * is asking for it. Leave the meeting page and the portal target disappears; the
 * component — and with it the MediaRecorder, the audio graph, the upload queue
 * and the timer — carries on untouched, and shows itself as a floating pill
 * instead. Come back and it reappears in place, still counting.
 *
 * What this deliberately does not do is survive a tab close or a reload. That
 * needs the capture to live somewhere other than the page, which the browser
 * doesn't offer for a microphone. The existing `beforeunload` guard still warns.
 */

/** Which meeting a recorder should be serving, and how it should present. */
export type RecordingSlot = {
  meetingId: string;
  meetingType: MeetingType;
  canSendNoteTaker: boolean;
};

type Registration = RecordingSlot & { container: HTMLElement };

type SessionValue = {
  /** The meeting currently being recorded, if any. Null when nothing is live. */
  activeMeetingId: string | null;
  register: (slot: RecordingSlot, container: HTMLElement) => void;
  unregister: (meetingId: string) => void;
};

const Ctx = createContext<SessionValue | null>(null);

export function useRecordingSession(): SessionValue {
  const found = useContext(Ctx);
  // Null only outside the provider, which would mean the layout stopped
  // mounting it. Fail soft: pages keep rendering, recordings just don't persist.
  return (
    found ?? { activeMeetingId: null, register: () => {}, unregister: () => {} }
  );
}

/**
 * Loaded on demand. The recorder pulls in the live transcriber, the audio-health
 * helpers and a good deal of canvas work; putting it in the layout must not mean
 * shipping all of that to the employees list. `ssr: false` because it touches
 * `navigator` and `document` on the way up.
 */
const MeetingRecorder = dynamic(
  () =>
    import("@/app/(app)/meetings/[id]/MeetingRecorder").then(
      (m) => m.MeetingRecorder,
    ),
  { ssr: false },
);

export function RecordingSessionProvider({
  children,
}: {
  children: ReactNode;
}) {
  // What the page currently on screen has asked for, if it asked at all.
  const [slot, setSlot] = useState<Registration | null>(null);
  // What is actually recording. Held separately and deliberately: it outlives
  // the page that started it, which is the entire point of this file.
  const [active, setActive] = useState<RecordingSlot | null>(null);

  const register = useCallback(
    (next: RecordingSlot, container: HTMLElement) =>
      setSlot({ ...next, container }),
    [],
  );
  const unregister = useCallback(
    (meetingId: string) =>
      setSlot((cur) => (cur?.meetingId === meetingId ? null : cur)),
    [],
  );

  // A live recording outranks whatever page you happen to be looking at.
  const target: RecordingSlot | null = active ?? slot;
  // ...and only shows itself in the page when that page is its own meeting.
  const container =
    slot && target && slot.meetingId === target.meetingId
      ? slot.container
      : null;

  const value = useMemo(
    () => ({ activeMeetingId: active?.meetingId ?? null, register, unregister }),
    [active, register, unregister],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {target && (
        <MeetingRecorder
          // Remounting is how a recorder is reset between meetings. Safe only
          // because `target` cannot change while a recording is retainable —
          // `active` pins it until the recorder itself says it is done.
          key={target.meetingId}
          meetingId={target.meetingId}
          meetingType={target.meetingType}
          canSendNoteTaker={target.canSendNoteTaker}
          container={container}
          onRetainedChange={(retained) => setActive(retained ? target : null)}
        />
      )}
    </Ctx.Provider>
  );
}

/**
 * Where the recorder appears on a meeting page.
 *
 * Renders an empty div and tells the provider about it; the recorder's own
 * markup is portalled in. When a *different* meeting is recording, it says so
 * instead of offering a second recorder — one microphone, one recording.
 */
export function RecordingSlotView({
  meetingId,
  meetingType,
  canSendNoteTaker = false,
}: {
  meetingId: string;
  meetingType: MeetingType;
  canSendNoteTaker?: boolean;
}) {
  const { activeMeetingId, register, unregister } = useRecordingSession();
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const busyElsewhere = activeMeetingId !== null && activeMeetingId !== meetingId;

  useEffect(() => {
    if (!el || busyElsewhere) return;
    register({ meetingId, meetingType, canSendNoteTaker }, el);
    return () => unregister(meetingId);
  }, [
    el,
    busyElsewhere,
    meetingId,
    meetingType,
    canSendNoteTaker,
    register,
    unregister,
  ]);

  if (busyElsewhere) {
    return (
      <div className="card border-dashed p-5 text-sm text-[var(--color-text-secondary)]">
        <p className="font-medium text-[var(--color-heading)]">
          Another meeting is recording
        </p>
        <p className="mt-1 text-[var(--color-text-muted)]">
          Echo records one meeting at a time, through this device&apos;s
          microphone. Stop that one — the pill in the corner will take you to
          it — before starting this.
        </p>
      </div>
    );
  }

  return <div ref={setEl} />;
}
