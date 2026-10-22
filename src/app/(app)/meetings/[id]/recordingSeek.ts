"use client";

export const RECORDING_SEEK_EVENT = "meetmate:recording-seek";

export function seekRecording(timeSeconds: number): void {
  if (!Number.isFinite(timeSeconds) || timeSeconds < 0) return;
  window.dispatchEvent(
    new CustomEvent(RECORDING_SEEK_EVENT, {
      detail: { timeSeconds },
    }),
  );
}
