"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { syncEmployees } from "./actions";

export function SyncButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const onClick = () =>
    startTransition(async () => {
      setMsg(null);
      try {
        const count = await syncEmployees();
        setMsg(`Synced ${count} employees`);
        router.refresh();
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "Sync failed");
      }
    });

  return (
    <div className="flex items-center gap-3">
      {msg && (
        <span className="text-xs text-[var(--color-text-secondary)]">{msg}</span>
      )}
      <button
        onClick={onClick}
        disabled={isPending}
        className={`inline-flex items-center gap-2 ${
          compact
            ? "btn-secondary px-3 py-1.5 text-sm"
            : "btn-primary px-4 py-2 text-sm"
        }`}
      >
        {isPending && (
          <span
            className={`inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-t-transparent ${
              compact ? "border-[var(--color-border-strong)]" : "border-[#181818]/40"
            }`}
          />
        )}
        {isPending ? "Syncing…" : "Sync from Bitrix"}
      </button>
    </div>
  );
}
