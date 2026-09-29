"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveMeetingRecording, ingestRecordingFromUrl } from "../actions";

type Tab = "file" | "url";

export function AudioImport({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("file");
  const [url, setUrl] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const submitFile = () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose an audio or video file first.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.append("recording", file, file.name);
        await saveMeetingRecording(meetingId, fd);
        router.refresh();
      } catch {
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
    startTransition(async () => {
      try {
        await ingestRecordingFromUrl(meetingId, url);
        router.refresh();
      } catch (e) {
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
