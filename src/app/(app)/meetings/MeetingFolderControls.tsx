"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import {
  deleteMeetingFolder,
  moveMeetingToFolder,
  renameMeetingFolder,
} from "./actions";

export function MeetingFolderSelector({
  meetingId,
  folderId,
  folders,
  meetingTitle,
}: {
  meetingId: string;
  folderId: string | null;
  folders: { id: string; name: string }[];
  meetingTitle: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState(folderId ?? "");
  const [savedFolder, setSavedFolder] = useState(folderId ?? "");
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const menuId = useId();
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedName =
    folders.find((folder) => folder.id === selected)?.name ?? "Unfiled";

  useEffect(() => {
    if (!menuOpen) return;
    function closeOutside(event: PointerEvent) {
      if (!pickerRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [menuOpen]);

  function cancel() {
    setSelected(savedFolder);
    setError("");
    setMenuOpen(false);
  }

  function save() {
    startTransition(async () => {
      setError("");
      try {
        await moveMeetingToFolder(meetingId, selected);
        setSavedFolder(selected);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't move meeting");
      }
    });
  }

  function focusOption(index: number) {
    const normalized = (index + folders.length + 1) % (folders.length + 1);
    optionRefs.current[normalized]?.focus();
  }

  function handlePickerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setMenuOpen(true);
      const selectedIndex = folders.findIndex((folder) => folder.id === selected);
      const currentIndex = selectedIndex + 1;
      const nextIndex =
        event.key === "ArrowDown"
          ? (currentIndex + 1) % (folders.length + 1)
          : (currentIndex - 1 + folders.length + 1) % (folders.length + 1);
      requestAnimationFrame(() => focusOption(nextIndex));
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setMenuOpen((open) => !open);
    }
  }

  return (
    <div
      ref={pickerRef}
      className="relative ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1"
    >
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={`Folder for ${meetingTitle}`}
        aria-haspopup="listbox"
        aria-expanded={menuOpen}
        aria-controls={menuId}
        disabled={pending}
        onClick={() => setMenuOpen((open) => !open)}
        onKeyDown={handlePickerKeyDown}
        className={`group inline-flex h-9 min-w-[112px] max-w-36 items-center justify-between gap-3 rounded-xl border px-3 text-xs font-semibold text-[var(--d-ink)] transition-all duration-200 ${
          menuOpen
            ? "border-violet-300/80 shadow-[0_0_0_3px_rgba(124,58,237,.12),0_12px_26px_-16px_rgba(75,70,165,.48)]"
            : "border-white/90 shadow-[inset_0_1px_0_rgba(255,255,255,.98),0_8px_20px_-15px_rgba(75,70,165,.38)] hover:-translate-y-px hover:border-violet-200"
        }`}
        style={{
          background:
            "linear-gradient(135deg,rgba(255,255,255,.88),rgba(239,234,255,.68) 54%,rgba(225,244,255,.72))",
          backdropFilter: "blur(20px) saturate(165%)",
          WebkitBackdropFilter: "blur(20px) saturate(165%)",
        }}
      >
        <span className="truncate">{selectedName}</span>
        <ChevronIcon open={menuOpen} />
      </button>

      {menuOpen && (
        <div
          id={menuId}
          role="listbox"
          aria-label={`Move ${meetingTitle} to folder`}
          className="absolute right-0 top-[calc(100%+8px)] z-50 max-h-64 min-w-44 overflow-y-auto rounded-2xl border border-white/90 p-1.5 shadow-[0_24px_55px_-22px_rgba(39,43,99,.38),inset_0_1px_0_rgba(255,255,255,.98)] animate-fade-in-up"
          style={{
            background:
              "linear-gradient(145deg,rgba(255,255,255,.9),rgba(240,235,255,.82) 55%,rgba(227,245,255,.86))",
            backdropFilter: "blur(28px) saturate(175%)",
            WebkitBackdropFilter: "blur(28px) saturate(175%)",
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setMenuOpen(false);
              triggerRef.current?.focus();
            }
          }}
        >
          {[
            { id: "", name: "Unfiled" },
            ...folders,
          ].map((folder, index) => {
            const isSelected = selected === folder.id;
            return (
              <button
                key={folder.id || "unfiled"}
                ref={(element) => {
                  optionRefs.current[index] = element;
                }}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  setSelected(folder.id);
                  setError("");
                  setMenuOpen(false);
                  triggerRef.current?.focus();
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    focusOption(index + 1);
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    focusOption(index - 1);
                  }
                }}
                className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13px] transition-all ${
                  isSelected
                    ? "bg-gradient-to-r from-violet-100/90 via-indigo-100/80 to-cyan-100/80 font-semibold text-[#37366f] shadow-[inset_0_1px_0_rgba(255,255,255,.9)]"
                    : "text-[var(--d-text)] hover:bg-white/65 hover:text-[var(--d-ink)]"
                }`}
              >
                <FolderIcon active={isSelected} />
                <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                {isSelected && <CheckIcon />}
              </button>
            );
          })}
        </div>
      )}

      <button
        type="button"
        onClick={save}
        disabled={pending || selected === savedFolder}
        aria-label={`Save folder for ${meetingTitle}`}
        title="Move meeting"
        className="grid h-7 w-7 place-items-center rounded-full text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-40"
      >
        <CheckIcon />
      </button>
      <button
        type="button"
        onClick={cancel}
        disabled={pending || selected === savedFolder}
        aria-label={`Cancel folder change for ${meetingTitle}`}
        title="Cancel"
        className="grid h-7 w-7 place-items-center rounded-full text-red-600 transition-colors hover:bg-red-100 disabled:opacity-40"
      >
        <CrossIcon />
      </button>
      {error && <span role="alert" className="basis-full text-right text-[10px] text-red-700">{error}</span>}
    </div>
  );
}

export function MeetingFolderActions({
  folderId,
  name,
  active,
}: {
  folderId: string;
  name: string;
  active: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function rename() {
    startTransition(async () => {
      setError("");
      try {
        await renameMeetingFolder(folderId, draft);
        setEditing(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't rename folder");
      }
    });
  }

  function remove() {
    if (!window.confirm(`Delete "${name}"? Meetings in it will become unfiled.`)) {
      return;
    }
    startTransition(async () => {
      setError("");
      try {
        await deleteMeetingFolder(folderId);
        if (active) router.replace("/meetings");
        else router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't delete folder");
      }
    });
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          value={draft}
          maxLength={100}
          aria-label={`Rename ${name}`}
          disabled={pending}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") rename();
            if (event.key === "Escape") {
              setDraft(name);
              setEditing(false);
            }
          }}
          className="d-input w-32 px-2 text-xs"
        />
        <button
          type="button"
          onClick={rename}
          disabled={pending || !draft.trim()}
          aria-label={`Save ${name}`}
          className="grid h-7 w-7 place-items-center rounded-full text-emerald-700 hover:bg-emerald-100 disabled:opacity-40"
        >
          <CheckIcon />
        </button>
        <button
          type="button"
          onClick={() => {
            setDraft(name);
            setEditing(false);
            setError("");
          }}
          disabled={pending}
          aria-label={`Cancel renaming ${name}`}
          className="grid h-7 w-7 place-items-center rounded-full text-red-600 hover:bg-red-100 disabled:opacity-40"
        >
          <CrossIcon />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        onClick={() => {
          setDraft(name);
          setEditing(true);
        }}
        disabled={pending}
        aria-label={`Rename ${name}`}
        title="Rename folder"
        className="grid h-7 w-7 place-items-center rounded-full text-[var(--d-muted)] hover:bg-[rgba(15,29,69,.08)] hover:text-[var(--d-ink)]"
      >
        <PencilIcon />
      </button>
      <button
        type="button"
        onClick={remove}
        disabled={pending}
        aria-label={`Delete ${name}`}
        title="Delete folder"
        className="grid h-7 w-7 place-items-center rounded-full text-red-600 hover:bg-red-100 disabled:opacity-40"
      >
        <TrashIcon />
      </button>
      {error && <span role="alert" className="basis-full text-right text-[10px] text-red-700">{error}</span>}
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <path d="m18 6-12 12M6 6l12 12" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m16 4 4 4M4 20l4-.8L19 8a2.1 2.1 0 0 0-3-3L5 16z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function FolderIcon({ active }: { active: boolean }) {
  return (
    <svg
      className={`shrink-0 ${active ? "text-violet-600" : "text-[var(--d-muted)]"}`}
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" />
    </svg>
  );
}
