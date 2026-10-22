"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AudioPlayer } from "./AudioPlayer";
import { RECORDING_SEEK_EVENT } from "./recordingSeek";

/**
 * The recording, as either audio or video.
 *
 * A toggle rather than two stacked players, for one reason that matters: only
 * the selected element is mounted, so there is no way to end up with the audio
 * and the video of the same meeting playing a half-second apart. It also keeps
 * the card one media surface tall instead of two.
 *
 * Audio stays the default. It's ours, it's ~15 MB, it starts instantly, and
 * it's what the transcript timestamps belong to. Video is the occasional "who
 * was that / what was on screen" trip, and it costs a round-trip to Recall
 * before a byte arrives — see the video route for why we don't keep a copy.
 *
 * Whether the video exists at all is only knowable by asking Recall, which is
 * too slow to do while rendering the page. The caller offers this tab whenever
 * a bot recorded the meeting, and a video that turns out to be missing lands on
 * the <video> element's error event — hence the inline recovery below rather
 * than an empty black rectangle.
 */
export function RecordingMedia({
  audioSrc,
  videoSrc,
  fallbackDuration,
}: {
  audioSrc: string;
  /** Omitted for meetings no bot attended — those are audio-only, and the
      toggle doesn't render at all. */
  videoSrc?: string;
  fallbackDuration?: string | null;
}) {
  const [tab, setTab] = useState<"audio" | "video">("audio");
  const [videoFailed, setVideoFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const pendingSeek = useRef<number | null>(null);

  const seekVideo = useCallback((timeSeconds: number) => {
    const video = videoRef.current;
    if (!video || video.readyState < 1) {
      pendingSeek.current = timeSeconds;
      setTab("video");
      return;
    }
    video.currentTime = Number.isFinite(video.duration)
      ? Math.min(timeSeconds, video.duration)
      : timeSeconds;
    pendingSeek.current = null;
    video.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  useEffect(() => {
    if (!videoSrc) return;
    const onSeek = (event: Event) => {
      const timeSeconds = (event as CustomEvent<{ timeSeconds?: number }>).detail
        ?.timeSeconds;
      if (typeof timeSeconds !== "number" || !Number.isFinite(timeSeconds)) return;
      if (videoFailed) {
        setTab("audio");
        return;
      }
      seekVideo(timeSeconds);
    };
    window.addEventListener(RECORDING_SEEK_EVENT, onSeek);
    return () => window.removeEventListener(RECORDING_SEEK_EVENT, onSeek);
  }, [seekVideo, videoSrc, videoFailed]);

  if (!videoSrc) {
    return <AudioPlayer src={audioSrc} fallbackDuration={fallbackDuration} />;
  }

  return (
    <div className="space-y-3">
      <div className="flex w-fit gap-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-1">
        <TabButton active={tab === "audio"} onClick={() => setTab("audio")}>
          Audio
        </TabButton>
        <TabButton active={tab === "video"} onClick={() => setTab("video")}>
          Video
        </TabButton>
      </div>

      {tab === "audio" ? (
        <AudioPlayer src={audioSrc} fallbackDuration={fallbackDuration} />
      ) : videoFailed ? (
        <p className="text-sm text-[var(--color-text-muted)]">
          The video isn&rsquo;t available for this meeting.{" "}
          <button
            type="button"
            onClick={() => setTab("audio")}
            className="underline underline-offset-2 hover:text-[var(--color-heading)]"
          >
            Play the audio instead
          </button>
        </p>
      ) : (
        // Native controls here, unlike the audio player: video chrome is
        // fullscreen, picture-in-picture and a scrub bar with frame previews,
        // and reimplementing that badly is worse than a control strip that
        // doesn't match the theme.
        //
        // preload="auto", not "metadata": this element only mounts once
        // someone has picked the Video tab, so the intent to watch is already
        // expressed and there is nothing to be coy about. Waiting for the play
        // click to start buffering a 140 MB file just moves the wait somewhere
        // more annoying. Nothing is fetched at all until the tab is picked,
        // which is the saving that actually mattered.
        <video
          ref={videoRef}
          src={videoSrc}
          controls
          playsInline
          preload="auto"
          onLoadedMetadata={() => {
            if (pendingSeek.current !== null) seekVideo(pendingSeek.current);
          }}
          onError={() => setVideoFailed(true)}
          className="w-full rounded-lg border border-[var(--color-border)] bg-black"
        />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-[var(--color-elevated)] text-[var(--color-heading)] shadow-sm"
          : "text-[var(--color-text-secondary)] hover:bg-[var(--color-muted-surface)] hover:text-[var(--color-heading)]"
      }`}
    >
      {children}
    </button>
  );
}
