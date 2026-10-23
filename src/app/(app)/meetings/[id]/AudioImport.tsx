"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveMeetingRecording, ingestRecordingFromUrl } from "../actions";
import { processingStartKey } from "./processingTimer";
import type { MeetingStatus } from "@/db/schema";

type Tab = "file" | "url";

export function AudioImport({
  meetingId,
  processing = false,
  status,
  stage,
}: {
  meetingId: string;
  processing?: boolean;
  status?: MeetingStatus;
  stage?: string | null;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("file");
  const [url, setUrl] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isPending && !processing) return;
    let startedAt = startedAtRef.current;
    if (startedAt === null) {
      try {
        const stored = Number(sessionStorage.getItem(processingStartKey(meetingId)));
        startedAt = Number.isFinite(stored) && stored > 0 ? stored : Date.now();
      } catch {
        startedAt = Date.now();
      }
      startedAtRef.current = startedAt;
    }
    const update = () => setElapsedSeconds(Math.floor((Date.now() - startedAt!) / 1000));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [isPending, processing, meetingId]);

  const beginWork = () => {
    startedAtRef.current = Date.now();
    setElapsedSeconds(0);
    try {
      sessionStorage.setItem(processingStartKey(meetingId), String(startedAtRef.current));
    } catch {
      // The live elapsed timer still works when session storage is unavailable.
    }
  };

  const submitFile = () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose an audio or video file first.");
      return;
    }
    setError(null);
    beginWork();
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.append("recording", file, file.name);
        await saveMeetingRecording(meetingId, fd);
        router.refresh();
      } catch {
        startedAtRef.current = null;
        try {
          sessionStorage.removeItem(processingStartKey(meetingId));
        } catch {
          // Storage is optional; the upload error is surfaced below.
        }
        setError("Failed to upload the file.");
      }
    });
  };

  const submitUrl = () => {
    if (!url.trim()) {
      setError("Paste a link to an audio or video file.");
      return;
    }
    setError(null);
    beginWork();
    startTransition(async () => {
      try {
        await ingestRecordingFromUrl(meetingId, url);
        router.refresh();
      } catch (e) {
        startedAtRef.current = null;
        try {
          sessionStorage.removeItem(processingStartKey(meetingId));
        } catch {
          // Storage is optional; the URL error is surfaced below.
        }
        setError(e instanceof Error ? e.message : "Failed to fetch the file.");
      }
    });
  };

  return (
    <section className="card p-5">
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
        Or analyze an existing recording
      </h2>
      <p className="mb-4 text-xs text-[var(--color-text-muted)]">
        Upload an audio/video file, or pull one from a URL (Zoom/Meet/Teams
        export, Drive link, etc.). Same transcription + minutes pipeline.
      </p>

      {processing ? (
        <div
          className="flex items-center gap-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-muted-surface)] p-5"
          role="status"
          aria-live="polite"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--color-elevated)]">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--color-border-strong)] border-t-[var(--color-heading)]" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[var(--color-heading)]">
              {stage === "extracting"
                ? "Preparing your recording"
                : status === "transcribing" || stage === "transcribing"
                  ? "Transcribing your meeting"
                  : status === "analyzing"
                    ? "Analyzing the conversation"
                    : "Processing your meeting"}
            </p>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Elapsed {formatElapsed(elapsedSeconds)} · This section will update when your meeting recap is ready.
            </p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--color-elevated)]">
              <div className="h-full w-1/3 animate-pulse rounded-full bg-[var(--color-bg-2)]" />
            </div>
          </div>
        </div>
      ) : (
      <>
      <div className="mb-4 inline-flex rounded-lg border border-[var(--color-border)] p-0.5">
        <button
          type="button"
          onClick={() => setTab("file")}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            tab === "file"
              ? "bg-[var(--color-elevated)] text-[var(--color-heading)]"
              : "text-[var(--color-text-secondary)] hover:text-[var(--color-heading)]"
          }`}
        >
          Upload file
        </button>
        <button
          type="button"
          onClick={() => setTab("url")}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            tab === "url"
              ? "bg-[var(--color-elevated)] text-[var(--color-heading)]"
              : "text-[var(--color-text-secondary)] hover:text-[var(--color-heading)]"
          }`}
        >
          From URL
        </button>
      </div>

      {tab === "file" ? (
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept="audio/*,video/*,.webm,.mp3,.m4a,.wav,.ogg,.mp4"
            onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
            className="block max-w-full text-sm text-[var(--color-text-secondary)] file:mr-4 file:rounded-md file:border-0 file:bg-[var(--color-elevated)] file:px-4 file:py-2 file:text-sm file:font-medium file:text-[var(--color-heading)] hover:file:bg-[var(--color-muted-surface)]"
          />
          <button
            type="button"
            onClick={submitFile}
            disabled={isPending}
            className="btn-ai inline-flex items-center gap-2 px-4 py-2"
          >
            {isPending ? <Spinner /> : <SparkleIcon />}
            {isPending ? "Uploading…" : "Analyze file"}
          </button>
          {fileName && !isPending && (
            <span className="text-xs text-[var(--color-text-muted)]">
              {fileName}
            </span>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…/meeting-recording.mp3"
            className="min-w-0 flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-muted-surface)] px-3 py-2 text-sm text-[var(--color-heading)] placeholder:text-[var(--color-text-muted)] outline-none transition-colors focus:border-[var(--color-border-strong)] focus:ring-1 focus:ring-[var(--color-border-strong)]"
          />
          <button
            type="button"
            onClick={submitUrl}
            disabled={isPending}
            className="btn-ai inline-flex items-center gap-2 px-4 py-2"
          >
            {isPending ? <Spinner /> : <SparkleIcon />}
            {isPending ? "Fetching…" : "Analyze URL"}
          </button>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      {isPending && (
        <div
          className="mt-5 flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-muted-surface)] p-4"
          role="status"
          aria-live="polite"
        >
          <Spinner />
          <div className="min-w-0">
            <p className="text-sm font-medium text-[var(--color-heading)]">
              {tab === "file" ? "Uploading and analyzing recording" : "Fetching and analyzing recording"}
            </p>
            <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
              Elapsed {formatElapsed(elapsedSeconds)} · Large recordings may take several minutes.
            </p>
          </div>
        </div>
      )}
      </>
      )}
    </section>
  );
}

function Spinner() {
  return (
    <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/50 border-t-transparent" />
  );
}

function SparkleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2l1.6 5.2a4 4 0 0 0 2.6 2.6L21.4 12l-5.2 1.6a4 4 0 0 0-2.6 2.6L12 21.4l-1.6-5.2a4 4 0 0 0-2.6-2.6L2.6 12l5.2-1.6a4 4 0 0 0 2.6-2.6L12 2z" />
    </svg>
  );
}

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}
