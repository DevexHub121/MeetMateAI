"use client";

import Image from "next/image";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateBotName } from "./actions";

/**
 * The note-taker's name, and a preview of how it appears in a call.
 *
 * The form and the preview are one component because the preview updates as you
 * type, and the point of this screen is what other people see: the name isn't
 * baked into the image, it's the label the meeting platform draws next to the
 * bot's camera feed. Showing them together is the difference between "set a
 * string" and "see what the room sees".
 */
export function NotetakerSettings({
  initialName,
  max,
  tileAvailable,
}: {
  initialName: string;
  max: number;
  /** False when the committed JPEGs couldn't be read — the bot still joins,
      just without a camera, and saying so beats a broken preview. */
  tileAvailable: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [saved, setSaved] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  const dirty = name.trim() !== saved;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!dirty || isPending) return;
    startTransition(async () => {
      setError(null);
      setJustSaved(false);
      try {
        const res = await updateBotName(name);
        setName(res.name);
        setSaved(res.name);
        setJustSaved(true);
        // Nothing else on screen reads this — the name is looked up when a bot
        // is dispatched — but refresh so a second tab isn't sitting on a stale
        // value it could later save back over this one.
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save");
      }
    });
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <form onSubmit={submit}>
        <label
          htmlFor="botName"
          className="block text-sm font-medium text-[var(--color-heading)]"
        >
          Note-taker name
        </label>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          What the note-taker calls itself in the participant list when it joins a meeting.
        </p>

        <div className="mt-3 flex gap-2">
          <input
            id="botName"
            value={name}
            maxLength={max}
            onChange={(e) => {
              setName(e.target.value);
              setJustSaved(false);
            }}
            placeholder="Notti"
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-heading)] outline-none placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-border-strong)]"
          />
          <button
            type="submit"
            disabled={!dirty || isPending}
            className="btn-primary shrink-0 px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isPending ? "Saving…" : "Save"}
          </button>
        </div>

        <div className="mt-2 flex items-start justify-between gap-3 text-xs">
          <span
            className={
              error
                ? "text-red-400"
                : justSaved
                  ? "text-emerald-400"
                  : "text-[var(--color-text-muted)]"
            }
          >
            {error ??
              (justSaved
                ? "Saved. New meetings will use this name."
                : "Applies to the next meeting you start — a bot already in a call keeps the name it joined with.")}
          </span>
          <span className="shrink-0 tabular-nums text-[var(--color-text-muted)]">
            {name.length}/{max}
          </span>
        </div>
      </form>

      <div>
        <p className="text-sm font-medium text-[var(--color-heading)]">
          In the call
        </p>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Notti joins with a camera, so it shows up as a labelled tile instead of
          a blank square.
        </p>

        {tileAvailable ? (
          <div className="mt-3 overflow-hidden rounded-xl border border-[var(--color-border)]">
            <div className="relative aspect-video bg-black">
              <Image
                src="/notetaker/recording.jpg"
                alt="The note-taker's camera tile: the Notti mark on a black background"
                fill
                sizes="26rem"
                className="object-cover"
              />
              {/* Roughly where Meet and Zoom draw the participant label. */}
              <span className="absolute bottom-2 left-2 max-w-[85%] truncate rounded bg-black/55 px-2 py-1 text-xs font-medium text-white">
                {name.trim() || "Notti"}
              </span>
            </div>
          </div>
        ) : (
          <p className="mt-3 rounded-xl border border-dashed border-[var(--color-border)] p-4 text-sm text-[var(--color-text-muted)]">
            The camera image couldn&rsquo;t be loaded, so the bot will join
            without one. Everything else works as normal.
          </p>
        )}

        <p className="mt-2 text-xs text-[var(--color-text-muted)]">
          The tile is editable in{" "}
          <code className="text-[var(--color-text-secondary)]">
            scripts/build-notetaker-tile.mjs
          </code>
          .
        </p>
      </div>
    </div>
  );
}
