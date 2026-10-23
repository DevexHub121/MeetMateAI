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
  preferVideo = false,
  fallbackDuration,
}: {
  audioSrc: string;
  /** Omitted for audio-only meetings. */
  videoSrc?: string;
  /** Uploaded video should be the initial view; bot video stays optional. */
  preferVideo?: boolean;
  fallbackDuration?: string | null;
}) {
  const [tab, setTab] = useState<"audio" | "video">(preferVideo ? "video" : "audio");
  const [videoFailed, setVideoFailed] = useState(false);
  const [videoLoading, setVideoLoading] = useState(preferVideo);
  const videoRef = useRef<HTMLVideoElement>(null);
  const pendingSeek = useRef<number | null>(null);

  const selectTab = useCallback((next: "audio" | "video") => {
    if (next === "video") {
      setVideoLoading(
        !videoRef.current ||
          videoRef.current.readyState < HTMLMediaElement.HAVE_FUTURE_DATA,
      );
    }
    setTab(next);
  }, []);

  useEffect(() => {
    if (tab !== "video") videoRef.current?.pause();
  }, [tab]);

  const seekVideo = useCallback((timeSeconds: number) => {
    const video = videoRef.current;
    if (!video || video.readyState < 1) {
      pendingSeek.current = timeSeconds;
      selectTab("video");
      return;
    }
    video.currentTime = Number.isFinite(video.duration)
      ? Math.min(timeSeconds, video.duration)
      : timeSeconds;
    pendingSeek.current = null;
    video.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [selectTab]);

  useEffect(() => {
    if (!videoSrc) return;
    const onSeek = (event: Event) => {
      const timeSeconds = (event as CustomEvent<{ timeSeconds?: number }>).detail
        ?.timeSeconds;
      if (typeof timeSeconds !== "number" || !Number.isFinite(timeSeconds)) return;
      if (videoFailed) {
        selectTab("audio");
        return;
      }
      seekVideo(timeSeconds);
    };
    window.addEventListener(RECORDING_SEEK_EVENT, onSeek);
    return () => window.removeEventListener(RECORDING_SEEK_EVENT, onSeek);
  }, [seekVideo, selectTab, videoSrc, videoFailed]);

  if (!videoSrc) {
    return <AudioPlayer src={audioSrc} fallbackDuration={fallbackDuration} />;
  }

  return (
    <div className="space-y-3">
      <div className="flex w-fit gap-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-1">
        <TabButton active={tab === "audio"} onClick={() => selectTab("audio")}>
          Audio
        </TabButton>
        <TabButton active={tab === "video"} onClick={() => selectTab("video")}>
          Video
        </TabButton>
      </div>

      <div className="relative">
        <div
          className={tab === "audio" ? "" : "pointer-events-none absolute inset-0 -z-10 opacity-0"}
          aria-hidden={tab !== "audio"}
        >
          <AudioPlayer
            src={audioSrc}
            active={tab === "audio"}
            fallbackDuration={fallbackDuration}
          />
        </div>
        {videoFailed ? (
          tab === "video" && (
            <p className="text-sm text-[var(--color-text-muted)]">
              The video isn&rsquo;t available for this meeting.{" "}
              <button
                type="button"
                onClick={() => selectTab("audio")}
                className="underline underline-offset-2 hover:text-[var(--color-heading)]"
              >
                Play the audio instead
              </button>
            </p>
          )
        ) : (
          // Keep the video mounted and preloading while the audio tab is active,
          // but remove it from layout and interaction until the user switches.
          <div
            className={`flex justify-center ${
              tab === "video"
                ? "relative"
                : "pointer-events-none absolute inset-0 -z-10 opacity-0"
            }`}
            aria-hidden={tab !== "video"}
          >
            <video
              ref={videoRef}
              src={videoSrc}
              controls
              playsInline
              preload="auto"
              onLoadStart={() => setVideoLoading(true)}
              onLoadedMetadata={() => {
                if (pendingSeek.current !== null) seekVideo(pendingSeek.current);
              }}
              onCanPlay={() => setVideoLoading(false)}
              onPlaying={() => setVideoLoading(false)}
              onWaiting={() => {
                if (tab === "video") setVideoLoading(true);
              }}
              onError={() => {
                setVideoLoading(false);
                setVideoFailed(true);
              }}
              className="aspect-video max-h-[400px] w-full max-w-full rounded-lg border border-[var(--color-border)] bg-black object-contain"
            />
            {tab === "video" && videoLoading && (
              <div
                className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-black/35"
                role="status"
                aria-label="Loading video"
              >
                <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/35 border-t-white" />
              </div>
            )}
          </div>
        )}
      </div>
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
